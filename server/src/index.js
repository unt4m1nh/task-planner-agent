require('dotenv').config()

const { Hono } = require('hono')
const { serve } = require('@hono/node-server')
const { preloadOllama, LlmProviderError } = require('./llm')
const { ingestDocument } = require('./rag/ingest')
const { searchDocuments } = require('./rag/search')
const { extractText } = require('./rag/extract')
const store = require('./store')
const wire = require('./adapters/wire')
const obsLogger = require('./obs/logger')
const { als } = require('./obs/session')
const { getObsSummary, getEvalRuns, getRecentEvents } = require('./obs/queries')

let _guardrails
async function getGuardrails() {
  if (!_guardrails) _guardrails = await import('./agent/guardrails.mjs')
  return _guardrails
}

let _history
async function getHistory() {
  if (!_history) _history = await import('./agent/history/store.mjs')
  return _history
}
let _historyConfig
async function getHistoryConfig() {
  if (!_historyConfig) _historyConfig = (await import('./agent/history/config.mjs')).default
  return _historyConfig
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const app = new Hono()

// ── CORS ──────────────────────────────────────────────────────────────────────

app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
})
app.options('*', (c) => c.text('', 204))

// ── Graph (ESM — load once via dynamic import) ────────────────────────────────

let _graphModule
function getGraphModule() {
  if (!_graphModule) {
    _graphModule = import('./agent/graph/graph.mjs').then(m => {
      m.setLog(obsLogger.log)
      return m
    })
  }
  return _graphModule
}

function getGraph() {
  return getGraphModule().then(m => m.app)
}

// ── /daily-planner slash command ──────────────────────────────────────────────
// Parsed directly, no LLM call. Injects plannerSlots into graph state.

function parseDailyPlanner(message) {
  if (!/^\/daily-planner\b/.test(message)) return null
  const args = message.slice('/daily-planner'.length).trim()
  const slots = { intent: 'plan' }

  const range = args.match(/(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/)
  if (range) {
    slots.startTime = `${range[1].padStart(2, '0')}:${range[2] || '00'}`
    slots.endTime   = `${range[3].padStart(2, '0')}:${range[4] || '00'}`
  } else {
    const hours = args.match(/(\d+(?:\.\d+)?)\s*h/i)
    const mins  = args.match(/(\d+)\s*m/i)
    if (hours) slots.availableMinutes = Math.round(parseFloat(hours[1]) * 60)
    else if (mins) slots.availableMinutes = parseInt(mins[1], 10)
  }

  return slots
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/dashboard', (c) => {
  const html = require('fs').readFileSync(require('path').resolve(__dirname, '../../dashboard/index.html'), 'utf8')
  return c.html(html)
})

app.get('/', (c) => c.json({ message: 'Task Agent API', version: 2 }))

app.get('/api/provider', (c) =>
  c.json({ provider: process.env.LLM_PROVIDER || 'ollama' })
)

app.post('/api/provider', async (c) => {
  let body
  try { body = await c.req.json() } catch {
    return c.json({ ok: false, error: 'request body must be valid JSON' }, 400)
  }
  const { provider } = body
  const validProviders = ['ollama', 'gemini', 'gemini-flash', 'gemma-31b']
  if (!validProviders.includes(provider)) {
    return c.json({ ok: false, error: `provider must be one of: ${validProviders.map(p => `"${p}"`).join(', ')}` }, 400)
  }
  process.env.LLM_PROVIDER = provider
  console.log(`[provider] switched to ${provider}`)
  return c.json({ ok: true, provider })
})

// POST /api/rag/documents — { title, content, source? } → ingest into the vector store
app.post('/api/rag/documents', async (c) => {
  let body
  try { body = await c.req.json() } catch {
    return c.json({ ok: false, error: 'request body must be valid JSON' }, 400)
  }
  const { title, content, source } = body ?? {}
  if (typeof title !== 'string' || !title.trim()) {
    return c.json({ ok: false, error: 'title (non-empty string) is required' }, 400)
  }
  if (typeof content !== 'string' || !content.trim()) {
    return c.json({ ok: false, error: 'content (non-empty string) is required' }, 400)
  }
  try {
    const { documentId, chunkCount } = await ingestDocument({
      source: source || 'upload', title, content,
    })
    return c.json({ ok: true, documentId, chunkCount })
  } catch (err) {
    console.error('[POST /api/rag/documents] error:', err)
    return c.json({ ok: false, error: 'ingest failed', detail: err.message }, 500)
  }
})

// POST /api/rag/upload — multipart/form-data { file, title? } → extract text from
// .pdf/.docx, chunk, embed, store. title defaults to the original filename.
app.post('/api/rag/upload', async (c) => {
  let body
  try { body = await c.req.parseBody() } catch {
    return c.json({ ok: false, error: 'request body must be multipart/form-data' }, 400)
  }
  const file = body?.file
  if (!(file instanceof File)) {
    return c.json({ ok: false, error: 'file is required' }, 400)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ ok: false, error: `file exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit` }, 400)
  }
  const title = (typeof body.title === 'string' && body.title.trim()) || file.name
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const content = await extractText(buffer, file.name)
    if (!content?.trim()) {
      return c.json({ ok: false, error: 'no extractable text found in file' }, 400)
    }
    const { documentId, chunkCount } = await ingestDocument({ source: 'upload', title, content })
    return c.json({ ok: true, documentId, chunkCount, title })
  } catch (err) {
    console.error('[POST /api/rag/upload] error:', err)
    return c.json({ ok: false, error: 'upload failed', detail: err.message }, 500)
  }
})

// POST /api/rag/search — { query, topK?, source? } → nearest chunks
app.post('/api/rag/search', async (c) => {
  let body
  try { body = await c.req.json() } catch {
    return c.json({ ok: false, error: 'request body must be valid JSON' }, 400)
  }
  const { query, topK, source } = body ?? {}
  if (typeof query !== 'string' || !query.trim()) {
    return c.json({ ok: false, error: 'query (non-empty string) is required' }, 400)
  }
  try {
    const results = await searchDocuments(query, { topK, source })
    return c.json({ ok: true, results })
  } catch (err) {
    console.error('[POST /api/rag/search] error:', err)
    return c.json({ ok: false, error: 'search failed', detail: err.message }, 500)
  }
})

// resolved_context persisted on the assistant turn — small and structured
// (ids/filters), never whole tasks/schedules. This is the warm-cache rebuild
// path for sessionContext after a process restart (see agent/history/DECISIONS.md).
function pickResolvedContext(sessionContext) {
  if (!sessionContext) return null
  const { activeRoute, activeIntent, lastListFilter, lastSchedule } = sessionContext
  if (!activeRoute && !activeIntent && !lastListFilter) return null
  return { activeRoute, activeIntent, lastListFilter: lastListFilter || null, hasPlan: !!lastSchedule }
}

// POST /api/chat
// Fresh turn:  { messages: [{role:"user", content:"..."}], threadId? }
// Resume turn: { resume: "approve"|"reject"|"<text>", threadId }
app.post('/api/chat', async (c) => {
  let body
  try { body = await c.req.json() } catch {
    return c.json({ ok: false, error: 'request body must be valid JSON' }, 400)
  }

  const { messages, threadId, resume } = body ?? {}

  const { Command } = await import('@langchain/langgraph')
  const { tracingEnabled } = await import('langsmith/client')
  const { checkInput, checkOutput } = await getGuardrails()
  const graph = await getGraph()
  const history = await getHistory()
  const historyConfig = await getHistoryConfig()
  const tid = threadId ?? crypto.randomUUID()
  const config = { configurable: { thread_id: tid } }

  history.getOrCreateSession(tid)
  const window = history.getRecentTurns(tid, historyConfig.windowSize)
  const historyWindow = history.formatWindowText(window)

  let input, userContent
  if (resume !== undefined) {
    userContent = typeof resume === 'string' ? resume : JSON.stringify(resume)
    const inputCheck = checkInput(userContent)
    obsLogger.log({ session_id: tid, component: 'guardrail_in', event_type: 'check', success: inputCheck.ok, latency_ms: null, details: { passed: inputCheck.ok, reason: inputCheck.code ?? null } })
    if (!inputCheck.ok) {
      return c.json({ ok: true, threadId: tid, response: inputCheck.userMessage })
    }
    input = new Command({ resume, update: { historyWindow } })
  } else {
    if (!Array.isArray(messages) || !messages.length) {
      return c.json({ ok: false, error: 'messages (non-empty array) is required for a fresh turn' }, 400)
    }
    const lastMsg = messages[messages.length - 1]?.content ?? ''
    if (typeof lastMsg !== 'string' || !lastMsg.trim()) {
      return c.json({ ok: false, error: 'last message content must be a non-empty string' }, 400)
    }
    userContent = lastMsg

    const inputCheck = checkInput(lastMsg)
    obsLogger.log({ session_id: tid, component: 'guardrail_in', event_type: 'check', success: inputCheck.ok, latency_ms: null, details: { passed: inputCheck.ok, reason: inputCheck.code ?? null } })
    if (!inputCheck.ok) {
      return c.json({ ok: true, threadId: tid, response: inputCheck.userMessage })
    }

    // Slash fast-path: inject plannerSlots, skip route model call
    const plannerSlots = parseDailyPlanner(lastMsg.trim())
    input = plannerSlots
      ? { messages, plannerSlots, historyWindow }
      : { messages, historyWindow }
  }

  let stateValues
  try {
    const _invokeStart = Date.now()
    stateValues = await als.run({ sessionId: tid }, () => graph.invoke(input, config))
    obsLogger.log({ session_id: tid, component: 'llm', event_type: 'llm_call', success: true, latency_ms: Date.now() - _invokeStart, details: { threadId: tid } })
  } catch (err) {
    console.error('[POST /api/chat] graph error:', err)
    obsLogger.log({ session_id: tid, component: 'system', event_type: 'error', success: false, latency_ms: null, details: { message: err.message, stack: err.stack?.slice(0, 500) } })
    if (err instanceof LlmProviderError) {
      return c.json({ ok: true, threadId: tid, response: err.userMessage })
    }
    return c.json({ ok: false, error: 'agent error', detail: err.message }, 500)
  }

  // Interrupt detection — clarify uses 202 (needs more input), approve uses 200
  const interrupted = stateValues.__interrupt__?.[0]?.value
  if (interrupted) {
    const status = interrupted.kind === 'clarify' ? 202 : 200
    const assistantContent = interrupted.question || interrupted.summary || JSON.stringify(interrupted)
    history.addTurn(tid, 'user', userContent)
    history.addTurn(tid, 'assistant', assistantContent, { resolvedContext: pickResolvedContext(stateValues.sessionContext) })
    return c.json({ ok: true, threadId: tid, awaitingInput: interrupted }, status)
  }

  const r = stateValues.result ?? {}

  // Output groundedness check — only applied to RAG answers (LLM-generated free text).
  // Todo/planner responses are code-constructed from store data and are always grounded.
  const allTaskIds = r.intent === 'ask'
    ? new Set(store.readTasks().map(t => t.id))
    : null
  const outputCheck = checkOutput(r, { allTaskIds })
  obsLogger.log({ session_id: tid, component: 'guardrail_out', event_type: 'check', success: outputCheck.ok, latency_ms: null, details: { passed: outputCheck.ok, reason: outputCheck.code ?? null } })
  if (!outputCheck.ok) {
    console.warn('[POST /api/chat] output guardrail fired:', outputCheck.code)
    return c.json({ ok: true, threadId: tid, response: outputCheck.userMessage })
  }

  history.addTurn(tid, 'user', userContent, { intent: r.intent || null })
  history.addTurn(tid, 'assistant', r.response ?? '', {
    intent: r.intent || null,
    resolvedContext: pickResolvedContext(stateValues.sessionContext),
  })

  return c.json({
    ok: true,
    threadId: tid,
    message: messages?.[messages?.length - 1]?.content ?? '',
    intent: r.intent ? { intent: r.intent } : undefined,
    response: r.response ?? '',
    ...(r.tasks    ? { tasks:    r.tasks    } : {}),
    ...(r.schedule ? { schedule: r.schedule } : {}),
    ...(r.sources  ? { sources:  r.sources  } : {}),
  })
})

// GET /api/sessions — list existing sessions (id, title, updated_at, turn count).
// Read-only — no HITL gate, per the project's "no HITL on read-only paths" rule.
app.get('/api/sessions', async (c) => {
  const history = await getHistory()
  return c.json({ ok: true, sessions: history.listSessions() })
})

// GET /api/sessions/:id — full turn history for one session, so the client
// can rehydrate it. Read-only — no HITL gate.
app.get('/api/sessions/:id', async (c) => {
  const history = await getHistory()
  const sessionId = c.req.param('id')
  const session = history.listSessions().find(s => s.sessionId === sessionId)
  if (!session) {
    return c.json({ ok: false, error: 'session not found' }, 404)
  }
  return c.json({ ok: true, session, turns: history.getAllTurns(sessionId) })
})

// ── Observability read endpoints ──────────────────────────────────────────────

app.get('/api/obs/summary', (c) => {
  try {
    return c.json({ ok: true, ...getObsSummary() })
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

app.get('/api/obs/events', (c) => {
  const component = c.req.query('component') || undefined
  const limit = parseInt(c.req.query('limit') || '100', 10)
  try {
    return c.json({ ok: true, events: getRecentEvents({ component, limit }) })
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

app.get('/api/obs/eval', (c) => {
  const evalType = c.req.query('type') || undefined
  try {
    return c.json({ ok: true, runs: getEvalRuns(evalType) })
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500)
  }
})

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`)
  preloadOllama()
  wire.init().then(() => {
    if (wire.isConfigured()) console.log('[jira] mcp-atlassian connected')
  }).catch(err => console.warn('[jira] connect failed:', err.message))
})

process.on('SIGTERM', () => wire.shutdown().finally(() => process.exit(0)))
process.on('SIGINT',  () => wire.shutdown().finally(() => process.exit(0)))
