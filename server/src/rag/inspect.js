const { getDb } = require('./db')

const db = getDb()

console.log('--- documents ---')
console.table(db.prepare(
  'SELECT id, source, title, length(content) AS chars, created_at FROM documents'
).all())

console.log('--- chunks ---')
console.table(db.prepare(
  'SELECT id, document_id, chunk_index, substr(text,1,60) AS preview FROM chunks'
).all())

console.log('--- vec_chunks ---')
console.table(db.prepare(
  'SELECT rowid, vec_length(embedding) AS dims FROM vec_chunks'
).all())
