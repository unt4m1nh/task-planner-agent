'use strict'
// Chunking eval: ingest the same corpus twice under two strategies, compare hit-rates.
// Usage: node eval/run_chunking_eval.js [--note "description"]
// The "before" strategy is fixed_size; the "after" strategy is recursive.
require('dotenv').config({ path: require('path').resolve(__dirname, '../server/.env') })
const fs = require('fs')
const path = require('path')
const { ingestDocument } = require('../server/src/rag/ingest')
const { searchDocuments } = require('../server/src/rag/search')
const { saveRun } = require('./report')

const CASES = fs.readFileSync(path.join(__dirname, 'datasets/chunking_cases.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

const NOTE = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : 'fixed_size vs recursive'

// Shared test corpus, one doc per case ID used in chunking_cases
const CORPUS = {
  chunking_test_A: { title: 'Sprint Guide', content: 'Sprint planning sets the goals for a 2-week sprint. The retrospective at the end reviews what went well, what did not, and what to improve. Sprint velocity is measured in story points completed per sprint. Daily standups keep the team aligned during the sprint.' },
  chunking_test_B: { title: 'Docker Networking', content: 'Docker containers communicate over virtual networks. The bridge network is the default for single-host networking. Overlay networks enable multi-host container communication. Port binding maps container ports to host ports using -p flag.' },
  chunking_test_C: { title: 'API Auth Guide', content: 'JWT (JSON Web Tokens) are a compact way to securely transmit information. A JWT consists of a header, payload, and signature. The Authorization header carries the bearer token: Authorization: Bearer <token>. Tokens expire after a configured TTL.' },
  chunking_test_D: { title: 'DB Optimization', content: 'Database indexes speed up query execution by creating a lookup structure. B-tree indexes are suited for range queries. Composite indexes cover multi-column WHERE clauses. An index on a frequently filtered column can reduce full-table scans dramatically.' },
  chunking_test_E: { title: 'Python Async', content: "Python's asyncio library enables asynchronous programming. A coroutine is defined with async def and paused with await. The event loop runs coroutines concurrently without threads. asyncio.gather() runs multiple coroutines in parallel." },
}

async function scoreStrategy(strategyName, sourceTag) {
  for (const c of CASES) {
    const doc = CORPUS[c.doc_id]
    if (!doc) continue
    await ingestDocument({ source: sourceTag, title: doc.title, content: doc.content, strategyOverride: strategyName })
  }

  let hits = 0
  const results = []
  for (const c of CASES) {
    const docs = await searchDocuments(c.query, { topK: 3, source: sourceTag })
    const combined = docs.map(d => d.text.toLowerCase()).join(' ')
    const matched = c.expected_keywords.filter(kw => combined.includes(kw.toLowerCase()))
    const pass = matched.length === c.expected_keywords.length
    if (pass) hits++
    results.push({ id: c.id, pass, matched: matched.length, total: c.expected_keywords.length })
    console.log(`  [${strategyName}] ${pass ? '✓' : '✗'} [${c.id}] "${c.query}"`)
  }
  return { score: hits / CASES.length, results }
}

async function run() {
  console.log('[chunking] scoring fixed_size strategy…')
  const before = await scoreStrategy('fixed_size', 'eval_chunking_fixed')

  console.log('[chunking] scoring recursive strategy…')
  const after = await scoreStrategy('recursive', 'eval_chunking_recursive')

  console.log(`\n  fixed_size: ${(before.score * 100).toFixed(1)}%`)
  console.log(`  recursive:  ${(after.score * 100).toFixed(1)}%`)

  saveRun({ eval_type: 'chunking', score: before.score, n_cases: CASES.length, note: 'fixed_size (before)', details: before.results })
  saveRun({ eval_type: 'chunking', score: after.score, n_cases: CASES.length, note: 'recursive (after)', details: after.results })
}

run().catch(err => { console.error(err); process.exit(1) })
