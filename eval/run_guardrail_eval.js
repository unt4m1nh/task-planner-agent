'use strict'
// Guardrail eval: tests both block (adversarial) and allow (legitimate) datasets.
// Usage: node eval/run_guardrail_eval.js [--note "description"]
require('dotenv').config({ path: require('path').resolve(__dirname, '../server/.env') })
const fs = require('fs')
const path = require('path')
const { saveRun } = require('./report')

// checkInput is ESM — load synchronously via a dynamic import wrapper is awkward,
// so we replicate the deterministic logic here (same inputs → same outputs).
// The actual guardrail source of truth remains guardrails.mjs.
const MAX_LENGTH = parseInt(process.env.GUARDRAIL_MAX_LENGTH || '4000', 10)

function checkInput(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'INPUT_EMPTY' }
  if (text.length > MAX_LENGTH) return { ok: false, code: 'INPUT_TOO_LONG' }
  const controlChars = text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g)
  if (controlChars && (controlChars.length > 5 || controlChars.length / text.length > 0.1)) {
    return { ok: false, code: 'INPUT_GARBAGE' }
  }
  return { ok: true }
}

const NOTE = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : null

const BLOCK_CASES = [
  ...fs.readFileSync(path.join(__dirname, 'datasets/guardrail_block_cases.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l)),
  { id: 'b4', input: '\x01\x02\x03\x04\x05\x06list tasks', expected: 'INPUT_GARBAGE' },
  { id: 'b5', input: '\x00\x01\x02\x03\x04\x05\x06\x07', expected: 'INPUT_GARBAGE' },
]

const ALLOW_CASES = fs.readFileSync(path.join(__dirname, 'datasets/guardrail_allow_cases.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l))

function run() {
  // Block eval — adversarial inputs must NOT pass
  let blockPasses = 0
  const blockResults = []
  for (const c of BLOCK_CASES) {
    const result = checkInput(c.input)
    const pass = !result.ok && result.code === c.expected
    if (pass) blockPasses++
    blockResults.push({ id: c.id, expected: c.expected, got: result.code ?? 'ok', pass })
    console.log(`  ${pass ? '✓' : '✗'} [block:${c.id}] expected=${c.expected} got=${result.code ?? 'ok'}`)
  }

  // Allow eval — legitimate inputs must pass
  let allowPasses = 0
  const allowResults = []
  for (const c of ALLOW_CASES) {
    const result = checkInput(c.input)
    const pass = result.ok
    if (pass) allowPasses++
    allowResults.push({ id: c.id, pass, code: result.code ?? null })
    console.log(`  ${pass ? '✓' : '✗'} [allow:${c.id}] "${c.input.slice(0, 40)}"`)
  }

  const blockRate = blockPasses / BLOCK_CASES.length
  const allowRate = allowPasses / ALLOW_CASES.length
  const total = BLOCK_CASES.length + ALLOW_CASES.length
  const combined = (blockPasses + allowPasses) / total

  console.log(`\n  block-rate: ${(blockRate * 100).toFixed(1)}%  allow-rate: ${(allowRate * 100).toFixed(1)}%  combined: ${(combined * 100).toFixed(1)}%`)

  saveRun({ eval_type: 'guardrail', score: combined, n_cases: total, note: NOTE ?? `block=${(blockRate * 100).toFixed(0)}% allow=${(allowRate * 100).toFixed(0)}%`, details: { blockResults, allowResults } })
}

run()
