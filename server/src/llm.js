const { readTasks } = require('./store')

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

// ─── core generate ────────────────────────────────────────────────────────────

async function generateOllama(prompt, schema, system) {
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    think: false,
    keep_alive: -1,
    options: { num_predict: 256 },
  }
  if (schema)  body.format = schema
  if (system)  body.system = system
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
  return data.response
}

async function generateGemini(prompt, schema, system) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set (required when LLM_PROVIDER=gemini)')

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  if (schema) {
    const generationConfig = {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
    }
    if (/^gemini-2\.5/.test(GEMINI_MODEL)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 }
    }
    body.generationConfig = generationConfig
  }

  const res = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gemini ${res.status}: ${text}`)
  }
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text
}

async function preloadOllama() {
  if ((process.env.LLM_PROVIDER || 'ollama') !== 'ollama') return
  try {
    // empty prompt = load the model into memory without generating
    await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, keep_alive: -1 }),
    })
    console.log(`[llm] ${OLLAMA_MODEL} preloaded and pinned in memory`)
  } catch (err) {
    console.error(`[llm] preload failed (is ollama running?): ${err.message}`)
  }
}

async function generate(prompt, schema, system) {
  const provider = process.env.LLM_PROVIDER || 'ollama'
  if (provider === 'gemini') return generateGemini(prompt, schema, system)
  if (provider === 'ollama') return generateOllama(prompt, schema, system)
  throw new Error(`Unknown LLM_PROVIDER: "${provider}" (expected "ollama" or "gemini")`)
}

module.exports = { generate, buildTaskContext, getToday, preloadOllama }
