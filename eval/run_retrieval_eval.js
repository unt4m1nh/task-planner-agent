'use strict'
// Retrieval eval: ingest test docs, run queries, score top-k hit rate.
// Usage: node eval/run_retrieval_eval.js [--note "description"]
require('dotenv').config({ path: require('path').resolve(__dirname, '../server/.env') })
const fs = require('fs')
const path = require('path')
const { ingestDocument } = require('../server/src/rag/ingest')
const { searchDocuments } = require('../server/src/rag/search')
const { saveRun } = require('./report')

const CASES = fs.readFileSync(path.join(__dirname, 'datasets/retrieval_cases.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

const NOTE = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : null

async function run() {
  console.log(`[retrieval] ingesting ${CASES.length} test documents…`)
  for (const c of CASES) {
    await ingestDocument({ source: 'eval_retrieval', title: c.doc_title, content: c.doc_content })
  }

  const results = []
  let hits = 0

  for (const c of CASES) {
    const docs = await searchDocuments(c.query, { topK: 3, source: 'eval_retrieval' })
    const combinedText = docs.map(d => d.text.toLowerCase()).join(' ')
    const matched = c.expected_keywords.filter(kw => combinedText.includes(kw.toLowerCase()))
    const pass = matched.length === c.expected_keywords.length
    if (pass) hits++
    results.push({ id: c.id, query: c.query, pass, matched, total: c.expected_keywords.length })
    console.log(`  ${pass ? '✓' : '✗'} [${c.id}] "${c.query}" → ${matched.length}/${c.expected_keywords.length} keywords`)
  }

  const score = hits / CASES.length
  saveRun({ eval_type: 'retrieval', score, n_cases: CASES.length, note: NOTE, details: results })
}

run().catch(err => { console.error(err); process.exit(1) })
