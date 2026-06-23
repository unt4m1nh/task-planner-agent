const path = require('path')
const Database = require('better-sqlite3')
const sqliteVec = require('sqlite-vec')

const EMBED_DIM = parseInt(process.env.RAG_EMBED_DIM || '1024', 10)
const DB_PATH = path.resolve(__dirname, '../../../rag.db')

let db

function getDb() {
  if (db) return db

  db = new Database(DB_PATH)
  sqliteVec.load(db)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL
    );
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      embedding float[${EMBED_DIM}]
    );
  `)

  return db
}

function toVecBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer)
}

module.exports = { getDb, toVecBuffer, EMBED_DIM, DB_PATH }
