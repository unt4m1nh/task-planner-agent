'use strict'
// Generation eval: ask the agent, grade the answer with Gemini Flash as judge.
// Requires GEMINI_API_KEY in server/.env. Skips gracefully if absent.
// Usage: node eval/run_generation_eval.js [--note "description"]
require('dotenv').config({ path: require('path').resolve(__dirname, '../server/.env') })
const fs = require('fs')
const path = require('path')
const https = require('https')
const { ingestDocument } = require('../server/src/rag/ingest')
const { retrieveStep, generateStep } = require('../server/src/rag/agentic')
const cfg = require('../server/src/config')
const { saveRun } = require('./report')

const CASES = fs.readFileSync(path.join(__dirname, 'datasets/generation_cases.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

const NOTE = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : null

const JUDGE_MODEL = cfg.eval.JUDGE_MODEL
const GEMINI_KEY = process.env.GEMINI_API_KEY

const LOOP_CORPUS = [
  { title: 'Sprint Guide', content: 'Sprint planning sets the goals for a 2-week sprint. The retrospective at the end reviews what went well, what did not, and what to improve. Sprint velocity is measured in story points completed per sprint.' },
  { title: 'Docker Networking', content: 'Docker containers communicate over virtual networks. The bridge network is the default for single-host networking. Port binding maps container ports to host ports using -p flag.' },
  { title: 'API Auth Guide', content: 'JWT (JSON Web Tokens) are a compact way to securely transmit information. A JWT consists of a header, payload, and signature. The Authorization header carries the bearer token.' },
  { title: 'ML Fundamentals', content: 'Overfitting occurs when a model memorizes training data. L1 regularization (Lasso) adds absolute weight sum to the loss. L2 regularization (Ridge) adds squared weights.' },
  { title: 'K8s Guide', content: 'A Kubernetes Deployment manages a set of replica Pods. Horizontal Pod Autoscaler scales replicas based on CPU or custom metrics.' },
]

function geminiJudge(question, answer, rubric) {
  return new Promise((resolve, reject) => {
    if (!GEMINI_KEY) return resolve({ pass: null, reason: 'no GEMINI_API_KEY' })

    const body = JSON.stringify({
      contents: [{ parts: [{ text: [
        'You are a strict answer grader.',
        `Question: ${question}`,
        `Rubric: ${rubric}`,
        `Answer: ${answer}`,
        '',
        'Does the answer satisfy the rubric? Reply with exactly: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}',
      ].join('\n') }] }],
    })

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${GEMINI_KEY}`
    const parsed = new URL(url)
    const req = https.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        try {
          const j = JSON.parse(data)
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          const m = text.match(/\{.*\}/s)
          if (m) resolve(JSON.parse(m[0]))
          else resolve({ pass: null, reason: 'could not parse judge response' })
        } catch (e) { resolve({ pass: null, reason: e.message }) }
      })
    })
    req.on('error', e => resolve({ pass: null, reason: e.message }))
    req.write(body)
    req.end()
  })
}

async function run() {
  if (!GEMINI_KEY) {
    console.warn('[generation] GEMINI_API_KEY not set — judge will return null for all cases')
  }

  console.log('[generation] ingesting corpus…')
  for (const doc of LOOP_CORPUS) {
    await ingestDocument({ source: 'loop_test', title: doc.title, content: doc.content })
  }

  let passes = 0
  let scorable = 0
  const results = []

  for (const c of CASES) {
    const docs = await retrieveStep(c.question, { topK: 3, source: 'loop_test' })
    const { answer } = await generateStep(c.question, docs, { includeTaskContext: false })
    const judgment = await geminiJudge(c.question, answer, c.rubric)

    if (judgment.pass !== null) {
      scorable++
      if (judgment.pass) passes++
    }
    results.push({ id: c.id, question: c.question, pass: judgment.pass, reason: judgment.reason, answer: answer.slice(0, 120) })
    console.log(`  ${judgment.pass === null ? '?' : judgment.pass ? '✓' : '✗'} [${c.id}] ${judgment.reason}`)
  }

  const score = scorable > 0 ? passes / scorable : 0
  saveRun({ eval_type: 'generation', score, n_cases: scorable, note: NOTE ?? `judge=${JUDGE_MODEL}`, details: results })
}

run().catch(err => { console.error(err); process.exit(1) })
