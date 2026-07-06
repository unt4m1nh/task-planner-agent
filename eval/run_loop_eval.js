'use strict'
// Agentic-loop eval: exercises retrieve→grade→rewrite loop directly, reads obs_events.
// Usage: node eval/run_loop_eval.js [--note "description"]
require('dotenv').config({ path: require('path').resolve(__dirname, '../server/.env') })
const fs = require('fs')
const path = require('path')
const { ingestDocument } = require('../server/src/rag/ingest')
const { retrieveStep, gradeStep, rewriteStep } = require('../server/src/rag/agentic')
const obsLogger = require('../server/src/obs/logger')
const cfg = require('../server/src/config')
const { saveRun } = require('./report')

const CASES = fs.readFileSync(path.join(__dirname, 'datasets/loop_cases.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

const NOTE = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : null

const MAX_ITERATIONS = cfg.rag.MAX_ITERATIONS

// Shared corpus for loop_test source — same docs used by retrieval eval
const LOOP_CORPUS = [
  { title: 'Sprint Guide', content: 'Sprint planning sets the goals for a 2-week sprint. The retrospective at the end reviews what went well, what did not, and what to improve. Sprint velocity is measured in story points completed per sprint. Daily standups keep the team aligned during the sprint.' },
  { title: 'Docker Networking', content: 'Docker containers communicate over virtual networks. The bridge network is the default for single-host networking. Overlay networks enable multi-host container communication. Port binding maps container ports to host ports using -p flag.' },
  { title: 'API Auth Guide', content: 'JWT (JSON Web Tokens) are a compact way to securely transmit information. A JWT consists of a header, payload, and signature. The Authorization header carries the bearer token: Authorization: Bearer <token>. Tokens expire after a configured TTL.' },
  { title: 'DB Optimization', content: 'Database indexes speed up query execution by creating a lookup structure. B-tree indexes are suited for range queries. Composite indexes cover multi-column WHERE clauses. An index on a frequently filtered column can reduce full-table scans dramatically.' },
  { title: 'Python Async', content: "Python's asyncio library enables asynchronous programming. A coroutine is defined with async def and paused with await. The event loop runs coroutines concurrently without threads. asyncio.gather() runs multiple coroutines in parallel." },
]

async function runLoop(query, source) {
  let currentQuery = query
  let iterations = 0
  let finalPassed = false

  while (iterations < MAX_ITERATIONS) {
    const docs = await retrieveStep(currentQuery, { topK: 3, source })
    const relevant = await gradeStep(currentQuery, docs)
    iterations++
    finalPassed = relevant

    obsLogger.log({
      session_id: `eval_loop_${Date.now()}`,
      component: 'rag_loop',
      event_type: 'iteration',
      success: relevant,
      latency_ms: null,
      details: { iteration_index: iterations - 1, similarity_score: relevant ? 1 : 0, passed: relevant, reformulated_query: currentQuery },
    })

    if (relevant) break
    if (iterations < MAX_ITERATIONS) {
      currentQuery = await rewriteStep(currentQuery)
    }
  }

  return { iterations, finalPassed }
}

async function run() {
  console.log('[loop] ingesting test corpus…')
  for (const doc of LOOP_CORPUS) {
    await ingestDocument({ source: 'loop_test', title: doc.title, content: doc.content })
  }

  let passes = 0
  const results = []

  for (const c of CASES) {
    const { iterations, finalPassed } = await runLoop(c.query, 'loop_test')
    let pass = false

    if (c.type === 'strong_first') {
      pass = iterations === 1 && finalPassed
    } else if (c.type === 'weak_recoverable') {
      pass = iterations > 1 && finalPassed
    } else if (c.type === 'unsatisfiable') {
      pass = iterations === MAX_ITERATIONS && !finalPassed
    }

    if (pass) passes++
    results.push({ id: c.id, type: c.type, iterations, finalPassed, pass })
    console.log(`  ${pass ? '✓' : '✗'} [${c.id}] ${c.type} → iterations=${iterations} passed=${finalPassed}`)
  }

  const score = passes / CASES.length
  saveRun({ eval_type: 'loop', score, n_cases: CASES.length, note: NOTE, details: results })
}

run().catch(err => { console.error(err); process.exit(1) })
