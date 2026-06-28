const { getDb, toVecBuffer } = require('./db')
const { embed } = require('./embeddings')
const { selectStrategy, getStrategy } = require('./chunking')

// strategyOverride bypasses selectStrategy() — only the comparison script
// (scripts/compare-chunking.js) uses it, to force the same document through
// two named strategies head-to-head. dbPath is the same escape hatch, for the
// same script's throwaway db file. Neither is passed in production code paths.
async function ingestDocument({ source, title, content, strategyOverride, dbPath }) {
  if (!content?.trim()) throw new Error('content is required')
  const db = getDb(dbPath)

  const strategyName = strategyOverride || selectStrategy(source, content, {})
  const strategy = getStrategy(strategyName)
  const produced = strategy.chunk({ text: content, sourceType: source, metadata: {} })
  if (!produced.length) throw new Error('content produced no chunks')

  const children = produced.filter(c => !c.isParent)
  const vectors = await embed(children.map(c => c.text))

  const insertDoc = db.prepare(
    'INSERT INTO documents (source, title, content, created_at) VALUES (?, ?, ?, ?)'
  )
  const insertChunk = db.prepare(
    'INSERT INTO chunks (document_id, chunk_index, text, source_type, strategy, parent_id, is_parent) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const insertVec = db.prepare(
    'INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)'
  )

  const documentId = db.transaction(() => {
    const { lastInsertRowid: docId } = insertDoc.run(
      source, title, content, new Date().toISOString()
    )

    // parents first so children can FK to a real chunks.id
    const parentRowIdByLocalId = new Map()
    let chunkIndex = 0
    for (const piece of produced) {
      if (!piece.isParent) continue
      const { lastInsertRowid: rowId } = insertChunk.run(
        docId, chunkIndex++, piece.text, source, strategyName, null, 1
      )
      parentRowIdByLocalId.set(piece.parentLocalId, rowId)
    }

    children.forEach((piece, i) => {
      const parentId = piece.parentLocalId != null
        ? parentRowIdByLocalId.get(piece.parentLocalId) ?? null
        : null
      const { lastInsertRowid: chunkId } = insertChunk.run(
        docId, chunkIndex++, piece.text, source, strategyName, parentId, 0
      )
      insertVec.run(BigInt(chunkId), toVecBuffer(vectors[i]))
    })

    return docId
  })()

  return { documentId, chunkCount: children.length, strategy: strategyName }
}

function fmtPlannerLog(schedule) {
  const lines = (schedule.blocks || []).map(b => {
    if (b.type === 'break') return `${b.start}-${b.end} break`
    const title = b.task?.title || 'task'
    const partial = b.partial ? ' (partial)' : ''
    return `${b.start}-${b.end} ${title}${partial}`
  })
  const dropped = (schedule.dropped || []).map(t => `- ${t.title}`)
  const parts = [
    `Daily plan for ${schedule.date} (${schedule.start}-${schedule.end}):`,
    lines.join('\n'),
  ]
  if (dropped.length) parts.push(`Dropped (did not fit):\n${dropped.join('\n')}`)
  return parts.join('\n\n')
}

async function ingestPlannerLog(schedule) {
  return ingestDocument({
    source: 'planner_log',
    title: `Daily plan ${schedule.date}`,
    content: fmtPlannerLog(schedule),
  })
}

module.exports = { ingestDocument, ingestPlannerLog }
