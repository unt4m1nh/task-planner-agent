'use strict'
const path = require('path')
const Database = require('better-sqlite3')

const DB_PATH = process.env.OBS_DB_PATH || path.resolve(__dirname, '../../../obs.db')

let _db

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.exec(`
      CREATE TABLE IF NOT EXISTS obs_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          TEXT    NOT NULL,
        session_id  TEXT,
        component   TEXT    NOT NULL,
        event_type  TEXT    NOT NULL,
        success     INTEGER,
        latency_ms  INTEGER,
        details     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_obs_ts        ON obs_events(ts);
      CREATE INDEX IF NOT EXISTS idx_obs_component ON obs_events(component);
      CREATE INDEX IF NOT EXISTS idx_obs_type      ON obs_events(event_type);

      CREATE TABLE IF NOT EXISTS eval_runs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT    NOT NULL,
        eval_type  TEXT    NOT NULL,
        score      REAL    NOT NULL,
        n_cases    INTEGER NOT NULL,
        note       TEXT,
        details    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_eval_ts   ON eval_runs(ts);
      CREATE INDEX IF NOT EXISTS idx_eval_type ON eval_runs(eval_type);
    `)
  }
  return _db
}

function log(event) {
  try {
    getDb().prepare(
      'INSERT INTO obs_events (ts, session_id, component, event_type, success, latency_ms, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      new Date().toISOString(),
      event.session_id ?? null,
      event.component,
      event.event_type,
      event.success == null ? null : (event.success ? 1 : 0),
      event.latency_ms ?? null,
      event.details != null ? JSON.stringify(event.details) : null
    )
  } catch (err) {
    console.error('[obs:log] failed:', err.message)
  }
}

module.exports = { log, getDb, DB_PATH }
