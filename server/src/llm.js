const { readTasks } = require('./store')

class LlmProviderError extends Error {
  constructor(message, { provider, statusCode, userMessage }) {
    super(message)
    this.name = 'LlmProviderError'
    this.provider = provider
    this.statusCode = statusCode
    this.userMessage = userMessage
  }
}

const OLLAMA_URL = 'http://localhost:11434/api/generate'
const OLLAMA_MODEL = 'gemma4:e2b'

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

// ─── task context builders ────────────────────────────────────────────────────

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function buildTaskContext() {
  const today = getToday()
  const all = readTasks()

  const todayTasks = all.filter(t => {
    if (!t.due_date) return false
    return t.due_date.slice(0, 10) === today
  })

  const overdue = all.filter(t => {
    if (!t.due_date || t.status === 'done') return false
    return t.due_date.slice(0, 10) < today
  })

  function fmtShort(t) {
    return `- [${t.id}] ${t.title} | ${t.status}`
  }

  const sections = []

  sections.push(`TODAY: ${today}`)

  if (todayTasks.length) {
    sections.push(`DUE TODAY: ${todayTasks.map(t => t.id).join(', ')}`)
  }

  if (overdue.length) {
    sections.push(`OVERDUE: ${overdue.map(t => t.id).join(', ')}`)
  }

  sections.push(
    `ALL TASKS (${all.length}):\n` + all.map(fmtShort).join('\n')
  )

  return sections.join('\n\n')
}

// ─── JSON Schema → Gemini Schema ──────────────────────────────────────────────
// Gemini's `responseSchema` is a constrained subset of OpenAPI 3.0: uppercase
// type names, and no support for `pattern`, `const`, `default`,
// `additionalProperties`, `minProperties`, `uniqueItems`, `if`/`then`. Strip
// those out and recurse through `properties`/`items`.

const GEMINI_TYPE = {
  object: 'OBJECT',
  string: 'STRING',
  array: 'ARRAY',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
}

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema

  const out = {}
  if (schema.type) out.type = GEMINI_TYPE[schema.type] || schema.type
  if (schema.description) out.description = schema.description
  if (schema.enum) out.enum = schema.enum
  if (schema.required) out.required = schema.required
  if (schema.items) out.items = toGeminiSchema(schema.items)
  if (schema.properties) {
    out.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = toGeminiSchema(value)
    }
  }
  return out
}

// ─── metrics logging ──────────────────────────────────────────────────────────
// One uniform line per call so Ollama and Gemini are comparable side by side.

function logMetrics(provider, model, wallMs, m = {}) {
  const parts = [`[llm] ${provider}/${model}`, `${Math.round(wallMs)}ms`]
  if (m.promptTokens != null) parts.push(`in=${m.promptTokens}tok`)
  if (m.outputTokens != null) parts.push(`out=${m.outputTokens}tok`)
  if (m.tokensPerSec != null) parts.push(`${m.tokensPerSec.toFixed(1)}tok/s`)
  if (m.loadMs != null) parts.push(`load=${Math.round(m.loadMs)}ms`)
  console.log(parts.join('  '))
}

// ─── core generate ────────────────────────────────────────────────────────────

async function generateOllama(prompt, schema, system, genOpts = {}) {
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    think: false,
    keep_alive: -1,
    options: { num_predict: 256, ...genOpts },
  }
  if (schema) body.format = schema
  if (system) body.system = system
  const startedAt = Date.now()
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama ${res.status}: ${text}`)
  }
  const data = await res.json()
  const evalSec = data.eval_duration ? data.eval_duration / 1e9 : null
  logMetrics('ollama', OLLAMA_MODEL, Date.now() - startedAt, {
    promptTokens: data.prompt_eval_count,
    outputTokens: data.eval_count,
    tokensPerSec: evalSec && data.eval_count ? data.eval_count / evalSec : null,
    loadMs: data.load_duration != null ? data.load_duration / 1e6 : null,
  })
  console.log('[llm] response:', data.response)
  return data.response
}

async function generateGemini(prompt, schema, system, genOpts = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set (required when LLM_PROVIDER=gemini)')

  const isGemini25 = /^gemini-2\.5/.test(GEMINI_MODEL)
  const isGemma    = /^gemma/i.test(GEMINI_MODEL)

  // Gemma via Google API has no responseSchema support (causes 500). Compensate
  // by embedding the JSON schema directly in the prompt — same contract that
  // Ollama enforces via constrained decoding, but as a prompt instruction.
  let effectivePrompt = prompt
  if (isGemma && schema) {
    effectivePrompt =
      prompt +
      '\n\nRequired JSON schema (you MUST follow this exactly — use only these fields and enum values):\n' +
      JSON.stringify(schema, null, 2) +
      '\n\nOutput ONLY the JSON object. No markdown fences, no explanation.'
  }

  const body = {
    contents: [{ parts: [{ text: effectivePrompt }] }],
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  const generationConfig = {}

  // thinkingConfig is gemini-2.5 only — Gemma and other models don't support it
  if (isGemini25) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }

  if (schema) {
    generationConfig.responseMimeType = 'application/json'
    if (!isGemma) {
      generationConfig.responseSchema = toGeminiSchema(schema)
    }
  }

  // Mirror Ollama's num_predict:256 default — Gemma has no constrained decoding
  // so without a cap it over-generates before emitting the JSON object
  const defaultMax = isGemma ? 512 : undefined
  generationConfig.maxOutputTokens = genOpts?.maxOutputTokens ?? defaultMax
  body.generationConfig = generationConfig

  const startedAt = Date.now()
  const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    const userMessage = res.status === 401
      ? "The AI service rejected the request — your API key may be invalid or expired. Check GEMINI_API_KEY and try again."
      : "The AI service returned an error. Please try again in a moment."
    throw new LlmProviderError(`Gemini ${res.status}: ${text}`, {
      provider: 'gemini',
      statusCode: res.status,
      userMessage,
    })
  }
  const data = await res.json()
  const wallMs = Date.now() - startedAt
  const usage = data.usageMetadata || {}

  // Thinking models (Gemma 4, Gemini 2.5) put internal reasoning in parts
  // with `thought: true`. Filter those out and join only the response parts.
  const allParts = data.candidates?.[0]?.content?.parts ?? []
  const responseParts = allParts.filter(p => !p.thought)
  const responseText = (responseParts.length ? responseParts : allParts)
    .map(p => p.text ?? '')
    .join('')

  logMetrics('gemini', GEMINI_MODEL, wallMs, {
    promptTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    tokensPerSec: usage.candidatesTokenCount ? usage.candidatesTokenCount / (wallMs / 1000) : null,
  })
  console.log('[llm] response:', responseText)
  return responseText
}

async function preloadOllama() {
  if ((process.env.LLM_PROVIDER || 'ollama') !== 'ollama') return
  // Lazy require: classify.js requires this module at load time, so importing
  // it at the top here would create a circular dependency. By call time
  // (server startup) both modules are fully initialized.
  const { SYSTEM: SYSTEM_PROMPT } = require('./agent/classify')
  const { ollamaSchema: INTENT_SCHEMA } = require('./agent/schema')
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        keep_alive: -1,
        system: SYSTEM_PROMPT,
        prompt: 'ping',
        format: INTENT_SCHEMA,
        options: { num_predict: 1 },
        stream: false,
      }),
    })
    if (!res.ok) {
      console.error(`[llm] preload HTTP ${res.status}: ${await res.text()}`)
      return
    }
    await res.json()
    console.log(`[llm] ${OLLAMA_MODEL} preloaded + prompt cache warmed`)
  } catch (err) {
    console.error(`[llm] preload failed (is ollama running?): ${err.message}`)
  }
}

async function generate(prompt, schema, system, genOpts) {
  const provider = process.env.LLM_PROVIDER || 'ollama'
  if (provider === 'gemini') return generateGemini(prompt, schema, system, genOpts)
  if (provider === 'ollama') return generateOllama(prompt, schema, system, genOpts)
  throw new Error(`Unknown LLM_PROVIDER: "${provider}" (expected "ollama" or "gemini")`)
}

module.exports = { generate, buildTaskContext, getToday, preloadOllama, LlmProviderError }
