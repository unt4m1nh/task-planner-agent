'use strict'
const { getDb } = require('./logger')

function getObsSummary() {
  const db = getDb()

  const requestsOverTime = db.prepare(`
    SELECT substr(ts, 1, 13) || ':00Z' AS hour, count(*) AS count
    FROM obs_events
    WHERE component = 'orchestrator' AND event_type = 'route'
    GROUP BY 1 ORDER BY 1 DESC LIMIT 48
  `).all()

  const perAgent = db.prepare(`
    SELECT json_extract(details, '$.intent') AS intent, count(*) AS count
    FROM obs_events
    WHERE component = 'orchestrator' AND event_type = 'route'
      AND json_extract(details, '$.intent') IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC
  `).all()

  const guardrailRow = db.prepare(`
    SELECT
      count(*) AS total,
      sum(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS blocked
    FROM obs_events
    WHERE component IN ('guardrail_in', 'guardrail_out') AND event_type = 'check'
  `).get()

  const ragIterRows = db.prepare(`
    SELECT session_id, count(*) AS iterations
    FROM obs_events
    WHERE component = 'rag_loop' AND event_type = 'iteration'
    GROUP BY session_id
  `).all()
  const avgRagIterations = ragIterRows.length
    ? ragIterRows.reduce((s, r) => s + r.iterations, 0) / ragIterRows.length
    : 0

  const errorRow = db.prepare(`
    SELECT
      count(*) AS total,
      sum(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) AS errors
    FROM obs_events
  `).get()

  return {
    requestsOverTime,
    perAgent,
    guardrailStats: {
      total: guardrailRow.total,
      blocked: guardrailRow.blocked,
      blockRate: guardrailRow.total ? guardrailRow.blocked / guardrailRow.total : 0,
    },
    avgRagIterations: parseFloat(avgRagIterations.toFixed(2)),
    errorRate: {
      total: errorRow.total,
      errors: errorRow.errors,
      rate: errorRow.total ? errorRow.errors / errorRow.total : 0,
    },
  }
}

function getEvalRuns(evalType) {
  const db = getDb()
  const rows = evalType
    ? db.prepare('SELECT * FROM eval_runs WHERE eval_type = ? ORDER BY ts DESC LIMIT 50').all(evalType)
    : db.prepare('SELECT * FROM eval_runs ORDER BY ts DESC LIMIT 100').all()
  return rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }))
}

function getRecentEvents({ component, limit = 100 } = {}) {
  const db = getDb()
  const rows = component
    ? db.prepare('SELECT * FROM obs_events WHERE component = ? ORDER BY ts DESC LIMIT ?').all(component, limit)
    : db.prepare('SELECT * FROM obs_events ORDER BY ts DESC LIMIT ?').all(limit)
  return rows.map(r => ({
    ...r,
    details: r.details ? JSON.parse(r.details) : null,
    success: r.success == null ? null : Boolean(r.success),
  }))
}

module.exports = { getObsSummary, getEvalRuns, getRecentEvents }
