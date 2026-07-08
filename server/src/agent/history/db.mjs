import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.HISTORY_DB_PATH || path.resolve(__dirname, '../../../../data/history.db')

let db

// dbPath is only for tests, which need an isolated throwaway file so they
// never touch the real history.db. Production code calls getDb() with no
// args and always gets the cached singleton at DB_PATH.
function getDb(dbPath = DB_PATH) {
  if (dbPath === DB_PATH && db) return db

  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')

  instance.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   TEXT PRIMARY KEY,
      title        TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      summary      TEXT
    );

    CREATE TABLE IF NOT EXISTS turns (
      turn_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       TEXT NOT NULL REFERENCES sessions(session_id),
      role             TEXT NOT NULL,
      content          TEXT NOT NULL,
      intent           TEXT,
      resolved_context TEXT,
      created_at       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session_time
      ON turns(session_id, created_at);
  `)

  if (dbPath === DB_PATH) db = instance
  return instance
}

export { getDb, DB_PATH }
