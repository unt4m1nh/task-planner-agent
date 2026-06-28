const { getDb, toVecBuffer } = require('./db')
const { embed } = require('./embeddings')

async function searchDocuments(query, { topK = 5, source, dbPath } = {}) {
  if (!query?.trim()) throw new Error('query is required')
  const db = getDb(dbPath)
  const [vector] = await embed([query])

  const matches = db.prepare(
    'SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ? ORDER BY distance'
  ).all(toVecBuffer(vector), topK * 4)

  const getChunk = db.prepare(`
    SELECT chunks.id, chunks.text, chunks.chunk_index, chunks.source_type, chunks.parent_id,
           documents.id AS document_id, documents.title, documents.source, documents.created_at
    FROM chunks JOIN documents ON documents.id = chunks.document_id
    WHERE chunks.id = ?
  `)
  const getParentText = db.prepare('SELECT text FROM chunks WHERE id = ?')

  const results = []
  for (const m of matches) {
    const row = getChunk.get(m.rowid)
    if (!row) continue
    if (source && row.source !== source) continue

    // parent_child strategy: the vector index only holds children (small,
    // precise matches); generation should see the parent's fuller context.
    let text = row.text
    if (row.parent_id != null) {
      const parent = getParentText.get(row.parent_id)
      if (parent) text = parent.text
    }

    results.push({
      text,
      matchedText: row.text,
      distance: m.distance,
      chunkIndex: row.chunk_index,
      documentId: row.document_id,
      title: row.title,
      source: row.source,
      sourceType: row.source_type,
      createdAt: row.created_at,
    })
    if (results.length >= topK) break
  }
  return results
}

module.exports = { searchDocuments }
