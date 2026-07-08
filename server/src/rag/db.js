const path = require('path')
const Database = require('better-sqlite3')
const sqliteVec = require('sqlite-vec')

const EMBED_DIM = parseInt(process.env.RAG_EMBED_DIM || '1024', 10)
const DB_PATH = process.env.RAG_DB_PATH || path.resolve(__dirname, '../../../data/rag.db')

let db

// dbPath is only for the chunking comparison script, which needs a throwaway
// SQLite file so it never touches the real corpus. Production code calls
// getDb() with no args and always gets the cached singleton at DB_PATH.
function getDb(dbPath = DB_PATH) {
  if (dbPath === DB_PATH && db) return db

  const instance = new Database(dbPath)
  sqliteVec.load(instance)
  instance.pragma('journal_mode = WAL')

  instance.exec(`
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
      text TEXT NOT NULL,
      source_type TEXT,
      strategy TEXT NOT NULL DEFAULT 'fixed_size',
      parent_id INTEGER REFERENCES chunks(id),
      is_parent INTEGER NOT NULL DEFAULT 0
    );
  `)
  instance.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      embedding float[${EMBED_DIM}]
    );
  `)

  // chunks created before source_type existed won't have the column on older
  // db files — add it and backfill from documents.source.
  const hasSourceType = instance.prepare("SELECT 1 FROM pragma_table_info('chunks') WHERE name = 'source_type'").get()
  if (!hasSourceType) {
    instance.exec('ALTER TABLE chunks ADD COLUMN source_type TEXT')
  }
  instance.exec(`
    UPDATE chunks SET source_type = (
      SELECT documents.source FROM documents WHERE documents.id = chunks.document_id
    ) WHERE source_type IS NULL
  `)

  // adaptive-chunking columns — older db files predate these; ALTER TABLE with a
  // non-null DEFAULT backfills existing rows to the pre-adaptive-chunking behavior
  // (every row was effectively a fixed_size cut, no parent/child relationship).
  const hasColumn = name => instance.prepare("SELECT 1 FROM pragma_table_info('chunks') WHERE name = ?").get(name)
  if (!hasColumn('strategy')) {
    instance.exec("ALTER TABLE chunks ADD COLUMN strategy TEXT NOT NULL DEFAULT 'fixed_size'")
  }
  if (!hasColumn('parent_id')) {
    instance.exec('ALTER TABLE chunks ADD COLUMN parent_id INTEGER REFERENCES chunks(id)')
  }
  if (!hasColumn('is_parent')) {
    instance.exec('ALTER TABLE chunks ADD COLUMN is_parent INTEGER NOT NULL DEFAULT 0')
  }

  if (dbPath === DB_PATH) db = instance
  return instance
}

function toVecBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer)
}

module.exports = { getDb, toVecBuffer, EMBED_DIM, DB_PATH }
