require('dotenv').config()

const { Hono } = require('hono')
const { serve } = require('@hono/node-server')
const { classify } = require('./agent/classify')
const { execute } = require('./agent/execute')
const { preloadOllama } = require('./llm')

const app = new Hono()

app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
})

app.options('*', (c) => c.text('', 204))

app.get('/', (c) => c.json({ message: 'Task Agent API', intents: ['list', 'read', 'add', 'edit', 'reorder', 'suggest'] }))

app.get('/api/provider', (c) => {
  return c.json({ provider: process.env.LLM_PROVIDER || 'ollama' })
})

app.post('/api/provider', async (c) => {
  let body
  try { body = await c.req.json() } catch {
    return c.json({ ok: false, error: 'request body must be valid JSON' }, 400)
  }
  const { provider } = body
  if (provider !== 'ollama' && provider !== 'gemini') {
    return c.json({ ok: false, error: 'provider must be "ollama" or "gemini"' }, 400)
  }
  process.env.LLM_PROVIDER = provider
  console.log(`[provider] switched to ${provider}`)
  return c.json({ ok: true, provider })
})

// "/daily-planner [9-17 | 09:00-17:00 | 4h | 240m]" — direct command, no LLM call
function parseDailyPlanner(message) {
  if (!/^\/daily-planner\b/.test(message)) return null
  const args = message.slice('/daily-planner'.length).trim()
  const intent = { intent: 'plan' }

  const range = args.match(/(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/)
  if (range) {
    intent.startTime = `${range[1].padStart(2, '0')}:${range[2] || '00'}`
    intent.endTime = `${range[3].padStart(2, '0')}:${range[4] || '00'}`
  } else {
    const hours = args.match(/(\d+(?:\.\d+)?)\s*h/i)
    const mins = args.match(/(\d+)\s*m/i)
    if (hours) intent.availableMinutes = Math.round(parseFloat(hours[1]) * 60)
    else if (mins) intent.availableMinutes = parseInt(mins[1], 10)
  }

  return intent
}

app.post('/api/chat', async (c) => {
  // 1. parse body
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'request body must be valid JSON' }, 400)
  }

  // 2. validate input
  const message = body?.message
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ ok: false, error: 'message (non-empty string) is required' }, 400)
  }

  // 3. classify — slash commands bypass the LLM
  let intent
  try {
    intent = parseDailyPlanner(message.trim()) ?? await classify(message.trim())
  } catch (err) {
    console.error('[POST /api/chat] classify error:', err)
    return c.json({ ok: false, error: 'classification failed', detail: err.message }, 500)
  }

  // 4. execute
  let result
  try {
    result = execute(intent)
  } catch (err) {
    console.error('[POST /api/chat] execute error:', err)
    return c.json({ ok: false, error: 'execution failed', detail: err.message }, 500)
  }

  // 5. return — execute returns a string, or { text, tasks? , schedule? } for structured results
  const response = typeof result === 'string' ? result : result.text
  const tasks = typeof result === 'string' ? undefined : result.tasks
  const schedule = typeof result === 'string' ? undefined : result.schedule

  return c.json({
    ok: true,
    message,
    intent,
    response,
    ...(tasks ? { tasks } : {}),
    ...(schedule ? { schedule } : {}),
  })
})

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`)
  preloadOllama()
})
