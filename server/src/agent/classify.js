const { generate, buildTaskContext } = require('../llm')
const { ollamaSchema } = require('./schema')

const MAX_RETRIES = 2

const VALID_INTENTS = ['list', 'read', 'add', 'edit', 'delete', 'reorder', 'suggest', 'plan', 'unknown']

const SYSTEM = `You are a task manager assistant. Classify the user message into one intent and extract slots.
Use the task context above to resolve task references (e.g. "that task", "the auth ticket", "JIRA-1042").

Intents:
- list    : list all tasks, or search/filter by status, priority, source, tags, or keyword
- read    : get a single specific task by id (needs id)
- add     : create a new task (needs title)
- edit    : change an existing task — direct field replacements (fields object) and/or
            appending to a field like tags, subtasks, or title (append: { field, value }) (needs id)
- delete  : permanently remove a task (needs id)
- reorder : move a task to top, bottom, before, or after another (needs id, to)
- suggest : recommend what to work on next — extract availableMinutes and/or mood from the message,
            do not pick tasks yourself
- plan    : build a schedule for the day — extract date, startTime, endTime, availableMinutes if given,
            do not pick or order tasks yourself
- unknown : cannot determine intent — set clarification to ask the user

Examples:
- "show me all my tasks"                   → {"intent":"list"}
- "show in progress tasks"                 → {"intent":"list","status":"in_progress"}
- "show high priority tasks"               → {"intent":"list","priority":"high"}
- "show jira tasks"                        → {"intent":"list","source":"jira"}
- "show wire tasks"                        → {"intent":"list","source":"wire"}
- "tasks tagged frontend"                  → {"intent":"list","tags":["frontend"]}
- "todo jira tasks tagged backend"         → {"intent":"list","status":"todo","source":"jira","tags":["backend"]}
- "find tasks about login"                 → {"intent":"list","query":"login"}

- "what should I work on next"                 → {"intent":"suggest"}
- "what should I work on, I have 30 min"       → {"intent":"suggest","availableMinutes":30}
- "I'm exhausted, what's a quick win"          → {"intent":"suggest","mood":"tired","preference":"quick"}
- "what's most important right now"            → {"intent":"suggest","preference":"important"}
- "30 minutes and low energy"                  → {"intent":"suggest","availableMinutes":30,"mood":"tired"}

- "plan my day"                                → {"intent":"plan"}
- "schedule my tasks from 9 to 5"              → {"intent":"plan","startTime":"09:00","endTime":"17:00"}
- "plan my day, I only have 4 hours"           → {"intent":"plan","availableMinutes":240}

IMPORTANT: Always extract filter slots when the user specifies status, priority, source, tags, or a keyword.
Never omit a filter the user mentioned. Only omit "query" for generic words like "tasks", "all", "my".
Use "tags" when the user says "tagged X" or "with tag X". For general topic keywords, prefer "query".
For suggest: mood must be one of "tired", "energetic", "neutral". Preference must be one of "quick", "important", "due_soon".`

// ─── JSON extraction ─────────────────────────────────────────────────────────
// Models without constrained decoding (e.g. Gemma via Google API) may wrap JSON
// in markdown fences or add preamble text. Extract the first {...} object.

function extractJSON(raw) {
  if (!raw) return null
  // Strip markdown code fences
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  // Find outermost { ... }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  return s.slice(start, end + 1)
}

// ─── validation ───────────────────────────────────────────────────────────────

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'result is not an object' }
  }

  const { intent } = parsed

  if (!intent || !VALID_INTENTS.includes(intent)) {
    return { ok: false, reason: `invalid or missing intent: "${intent}"` }
  }

  switch (intent) {
    case 'add':
      if (!parsed.title || typeof parsed.title !== 'string' || !parsed.title.trim()) {
        return { ok: false, reason: 'add requires a non-empty title' }
      }
      break

    case 'read':
      if (!parsed.id) return { ok: false, reason: 'read requires id' }
      break

    case 'edit': {
      if (!parsed.id) return { ok: false, reason: 'edit requires id' }
      const hasFields = parsed.fields && typeof parsed.fields === 'object' && Object.keys(parsed.fields).length > 0
      const hasAppend = parsed.append && typeof parsed.append === 'object' && parsed.append.field && parsed.append.value
      if (!hasFields && !hasAppend) {
        return { ok: false, reason: 'edit requires a non-empty fields object and/or an append { field, value }' }
      }
      break
    }

    case 'reorder':
      if (!parsed.id) return { ok: false, reason: 'reorder requires id' }
      if (!parsed.to) return { ok: false, reason: 'reorder requires to' }
      if ((parsed.to === 'before' || parsed.to === 'after') && !parsed.refId) {
        return { ok: false, reason: `reorder with to="${parsed.to}" requires refId` }
      }
      break
  }

  return { ok: true }
}

// ─── build prompt ─────────────────────────────────────────────────────────────

function buildPrompt(userMessage, previousError) {
  const context = buildTaskContext()

  const lines = [
    SYSTEM,
    '',
    '=== TASK CONTEXT ===',
    context,
    '=== END CONTEXT ===',
    '',
  ]

  if (previousError) {
    lines.push(`Previous attempt failed validation: ${previousError}`)
    lines.push('Fix the issue and try again.')
    lines.push('')
  }

  lines.push(`User: "${userMessage}"`, '', 'Output a single JSON object only. No markdown, no explanation, no code fences:')

  return lines.join('\n')
}

// ─── classify ─────────────────────────────────────────────────────────────────

async function classify(userMessage) {
  let lastError = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // 1. call model
    const prompt = buildPrompt(userMessage, lastError)
    let raw
    try {
      raw = await generate(prompt, ollamaSchema)
    } catch (err) {
      lastError = `model call failed: ${err.message}`
      console.error(`[classify] attempt ${attempt} — ${lastError}`)
      continue
    }

    // 2. parse JSON — strip markdown fences and extract first {...} object
    let parsed
    console.log(`\n\n[classify]: LLM response raw: ${raw}`)
    try {
      const cleaned = extractJSON(raw)
      if (!cleaned) throw new Error('no JSON object found')
      parsed = JSON.parse(cleaned)
    } catch {
      lastError = `JSON parse failed on: ${raw?.slice(0, 120)}`
      console.error(`[classify] attempt ${attempt} — ${lastError}`)
      continue
    }

    // 3. validate
    const { ok, reason } = validate(parsed)
    if (!ok) {
      lastError = reason
      console.error(`[classify] attempt ${attempt} — validation failed: ${reason}`)
      continue
    }

    // 4. success
    console.log(`[classify] intent="${parsed.intent}" slots=${JSON.stringify(parsed)}${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
    return parsed
  }

  // all retries exhausted
  console.error(`[classify] all ${MAX_RETRIES} attempts failed — last error: ${lastError}`)
  return {
    intent: 'unknown',
    clarification: "I couldn't understand that. Could you rephrase?",
  }
}

module.exports = { classify, validate, SYSTEM }
