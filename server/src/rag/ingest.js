const { getDb, toVecBuffer } = require('./db')
const { embed } = require('./embeddings')
const { chunkText } = require('./chunk')

async function ingestDocument({ source, title, content }) {
  if (!content?.trim()) throw new Error('content is required')
  const db = getDb()
  const chunks = chunkText(content)
  if (!chunks.length) throw new Error('content produced no chunks')

  const vectors = await embed(chunks)

  const insertDoc = db.prepare(
    'INSERT INTO documents (source, title, content, created_at) VALUES (?, ?, ?, ?)'
  )
  const insertChunk = db.prepare(
    'INSERT INTO chunks (document_id, chunk_index, text) VALUES (?, ?, ?)'
  )
  const insertVec = db.prepare(
    'INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)'
  )

  const documentId = db.transaction(() => {
    const { lastInsertRowid: docId } = insertDoc.run(
      source, title, content, new Date().toISOString()
    )
    chunks.forEach((text, i) => {
      const { lastInsertRowid: chunkId } = insertChunk.run(docId, i, text)
      insertVec.run(BigInt(chunkId), toVecBuffer(vectors[i]))
    })
    return docId
  })()

  return { documentId, chunkCount: chunks.length }
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
