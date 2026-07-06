'use strict'
// Runs all five evals in sequence, prints a combined summary.
// Usage: node eval/run_all.js
const { execSync } = require('child_process')
const path = require('path')

const runners = [
  'run_retrieval_eval.js',
  'run_chunking_eval.js',
  'run_loop_eval.js',
  'run_generation_eval.js',
  'run_guardrail_eval.js',
]

console.log('=== Running all evals ===\n')
for (const r of runners) {
  console.log(`\n--- ${r} ---`)
  try {
    execSync(`node ${path.join(__dirname, r)}`, { stdio: 'inherit' })
  } catch (e) {
    console.error(`[run_all] ${r} failed:`, e.message)
  }
}
console.log('\n=== Done. Check obs.db eval_runs table for persisted scores. ===')
