// Re-ingest the document corpus under the new strategy router (adaptive
// chunking, DoD §8). Scoped to documents, never planner_log — the
// planner-log corpus is already effectively no_chunking, so re-labelling its
// `strategy` column (done by the db.js migration's ALTER TABLE default) is
// enough; no re-embed needed there.
//
// Usage: node src/rag/scripts/reingest-documents.js
const { getDb } = require('../db')
const { ingestDocument } = require('../ingest')

async function main() {
  const db = getDb()

  const before = db.prepare(
    "SELECT COUNT(*) AS n FROM chunks WHERE source_type != 'planner_log'"
  ).get().n
  console.log(`Chunk rows before (excluding planner_log): ${before}`)

  const docs = db.prepare(
    "SELECT id, source, title, content FROM documents WHERE source != 'planner_log'"
  ).all()
  console.log(`Found ${docs.length} document(s) to re-ingest.`)

  const deleteVec = db.prepare('DELETE FROM vec_chunks WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)')
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE document_id = ?')
  const deleteDoc = db.prepare('DELETE FROM documents WHERE id = ?')

  for (const doc of docs) {
    db.transaction(() => {
      deleteVec.run(doc.id)
      deleteChunks.run(doc.id)
      deleteDoc.run(doc.id)
    })()
  }

  for (const doc of docs) {
    const { documentId, strategy, chunkCount } = await ingestDocument({
      source: doc.source,
      title: doc.title,
      content: doc.content,
    })
    console.log(`re-ingested "${doc.title}" -> documentId=${documentId} strategy=${strategy} chunks=${chunkCount}`)
  }

  const after = db.prepare(
    "SELECT COUNT(*) AS n FROM chunks WHERE source_type != 'planner_log'"
  ).get().n
  console.log(`Chunk rows after (excluding planner_log): ${after}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
