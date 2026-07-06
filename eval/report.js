'use strict'
// Shared: persist eval results to eval_runs table, print summary.
require('dotenv').config({ path: require('path').resolve(__dirname, '../server/.env') })
const obsLogger = require('../server/src/obs/logger')

function saveRun({ eval_type, score, n_cases, note, details }) {
  const db = obsLogger.getDb()
  const row = db.prepare(
    'INSERT INTO eval_runs (ts, eval_type, score, n_cases, note, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    new Date().toISOString(),
    eval_type,
    score,
    n_cases,
    note ?? null,
    details ? JSON.stringify(details) : null
  )
  const pct = (score * 100).toFixed(1)
  console.log(`[eval:${eval_type}] score=${pct}% n=${n_cases}${note ? ` note="${note}"` : ''} (run #${row.lastInsertRowid})`)
  return row.lastInsertRowid
}

module.exports = { saveRun }
