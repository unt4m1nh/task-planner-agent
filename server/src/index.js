require('dotenv').config()

const { Hono } = require('hono')
const { serve } = require('@hono/node-server')
const { preloadOllama, LlmProviderError } = require('./llm')
const { ingestDocument } = require('./rag/ingest')
const { searchDocuments } = require('./rag/search')
const { extractText } = require('./rag/extract')

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

let graphPromise
function getGraph() {
  if (!graphPromise) graphPromise = import('./agent/graph/graph.mjs').then(m => m.app)
  return graphPromise
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
  if (provider !== 'ollama' && provider !== 'gemini' && provider !== 'gemini-flash') {
    return c.json({ ok: false, error: 'provider must be "ollama", "gemini", or "gemini-flash"' }, 400)
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
  const graph = await getGraph()
  const tid = threadId ?? crypto.randomUUID()
  const config = { configurable: { thread_id: tid } }

  let input
  if (resume !== undefined) {
    input = new Command({ resume })
  } else {
    if (!Array.isArray(messages) || !messages.length) {
      return c.json({ ok: false, error: 'messages (non-empty array) is required for a fresh turn' }, 400)
    }
    const lastMsg = messages[messages.length - 1]?.content ?? ''
    if (typeof lastMsg !== 'string' || !lastMsg.trim()) {
      return c.json({ ok: false, error: 'last message content must be a non-empty string' }, 400)
    }

    // Slash fast-path: inject plannerSlots, skip route model call
    const plannerSlots = parseDailyPlanner(lastMsg.trim())
    input = plannerSlots
      ? { messages, plannerSlots }
      : { messages }
  }

  let stateValues
  try {
    stateValues = await graph.invoke(input, config)
  } catch (err) {
    console.error('[POST /api/chat] graph error:', err)
    if (err instanceof LlmProviderError) {
      return c.json({ ok: true, threadId: tid, response: err.userMessage })
    }
    return c.json({ ok: false, error: 'agent error', detail: err.message }, 500)
  }

  // Interrupt detection — clarify uses 202 (needs more input), approve uses 200
  const interrupted = stateValues.__interrupt__?.[0]?.value
  if (interrupted) {
    const status = interrupted.kind === 'clarify' ? 202 : 200
    return c.json({ ok: true, threadId: tid, awaitingInput: interrupted }, status)
  }

  const r = stateValues.result ?? {}
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

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`)
  preloadOllama()
})
