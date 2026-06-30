import { getDb } from './db.mjs'
import config from './config.mjs'

// dbPath is only for tests — a throwaway file so the real history.db is never
// touched. Production code (orchestrator, graph nodes) never passes it.

function toTurn(row) {
  return {
    turnId: row.turn_id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    intent: row.intent,
    resolvedContext: row.resolved_context ? JSON.parse(row.resolved_context) : null,
    createdAt: row.created_at,
  }
}

function createSession(title, opts = {}) {
  const db = getDb(opts.dbPath)
  const sessionId = opts.sessionId || crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (session_id, title, created_at, updated_at, summary) VALUES (?, ?, ?, ?, NULL)'
  ).run(sessionId, title || null, now, now)
  return sessionId
}

// Resumes sessionId if it already exists; otherwise creates a row for it
// (using that exact id, so it stays aligned with the caller's thread_id).
// With no sessionId at all, generates a fresh one.
function getOrCreateSession(sessionId, opts = {}) {
  const db = getDb(opts.dbPath)
  if (sessionId) {
    const existing = db.prepare('SELECT session_id FROM sessions WHERE session_id = ?').get(sessionId)
    if (existing) return sessionId
    return createSession(null, { ...opts, sessionId })
  }
  return createSession(null, opts)
}

function addTurn(sessionId, role, content, opts = {}) {
  const db = getDb(opts.dbPath)
  const { intent = null, resolvedContext = null } = opts
  const now = Date.now()
  const trimmedContent = String(content).slice(0, config.maxContentChars)
  const resolvedContextJson = resolvedContext != null ? JSON.stringify(resolvedContext) : null

  db.transaction(() => {
    db.prepare(
      'INSERT INTO turns (session_id, role, content, intent, resolved_context, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(sessionId, role, trimmedContent, intent, resolvedContextJson, now)

    db.prepare('UPDATE sessions SET updated_at = ? WHERE session_id = ?').run(now, sessionId)

    if (role === 'user') {
      const session = db.prepare('SELECT title FROM sessions WHERE session_id = ?').get(sessionId)
      if (session && !session.title) {
        db.prepare('UPDATE sessions SET title = ? WHERE session_id = ?')
          .run(trimmedContent.slice(0, config.titleMaxChars), sessionId)
      }
    }
  })()
}

// Last n turns, in CHRONOLOGICAL order (oldest -> newest) — the sliding
// window injected into a model prompt.
function getRecentTurns(sessionId, n, opts = {}) {
  const db = getDb(opts.dbPath)
  const rows = db.prepare(
    `SELECT turn_id, session_id, role, content, intent, resolved_context, created_at
     FROM turns WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(sessionId, n)
  return rows.reverse().map(toTurn)
}

function listSessions(opts = {}) {
  const db = getDb(opts.dbPath)
  return db.prepare(`
    SELECT s.session_id AS sessionId, s.title AS title,
           s.created_at AS createdAt, s.updated_at AS updatedAt,
           COUNT(t.turn_id) AS turnCount
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.session_id
    GROUP BY s.session_id
    ORDER BY s.updated_at DESC
  `).all()
}

// Reads resolved_context off the most recent assistant turn — the warm-cache
// rebuild path for SessionState/sessionContext after a process restart.
function getSessionResolvedContext(sessionId, opts = {}) {
  const db = getDb(opts.dbPath)
  const row = db.prepare(
    `SELECT resolved_context FROM turns
     WHERE session_id = ? AND role = 'assistant' AND resolved_context IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(sessionId)
  if (!row) return null
  try { return JSON.parse(row.resolved_context) } catch { return null }
}

function formatWindowText(turns) {
  if (!turns.length) return ''
  return turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n')
}

export {
  createSession,
  getOrCreateSession,
  addTurn,
  getRecentTurns,
  listSessions,
  getSessionResolvedContext,
  formatWindowText,
}
