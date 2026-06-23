const { getDb, toVecBuffer } = require('./db')
const { embed } = require('./embeddings')

async function searchDocuments(query, { topK = 5, source } = {}) {
  if (!query?.trim()) throw new Error('query is required')
  const db = getDb()
  const [vector] = await embed([query])

  const matches = db.prepare(
    'SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ? ORDER BY distance'
  ).all(toVecBuffer(vector), topK * 4)

  const getChunk = db.prepare(`
    SELECT chunks.id, chunks.text, chunks.chunk_index,
           documents.id AS document_id, documents.title, documents.source, documents.created_at
    FROM chunks JOIN documents ON documents.id = chunks.document_id
    WHERE chunks.id = ?
  `)

  const results = []
  for (const m of matches) {
    const row = getChunk.get(m.rowid)
    if (!row) continue
    if (source && row.source !== source) continue
    results.push({
      text: row.text,
      distance: m.distance,
      chunkIndex: row.chunk_index,
      documentId: row.document_id,
      title: row.title,
      source: row.source,
      createdAt: row.created_at,
    })
    if (results.length >= topK) break
  }
  return results
}

module.exports = { searchDocuments }
