// One-off comparison: old blind ~1200-char cut (chunk.js) vs the new
// adaptive-chunking router (chunking/), embedding both with bge-m3, over the
// files in docs/test-chunk. Not part of the production pipeline.
const fs = require('fs')
const path = require('path')
const { chunkText: oldChunkText } = require('./chunk')
const { selectStrategy, getStrategy } = require('./chunking')
const { embed, EMBED_MODEL } = require('./embeddings')
const { extractText } = require('./extract')

const TARGET_DIR = path.resolve(__dirname, '../../../docs/test-chunk')

async function loadContent(file, fullPath) {
  const ext = file.toLowerCase().split('.').pop()
  if (ext === 'pdf' || ext === 'docx') return extractText(fs.readFileSync(fullPath), file)
  return fs.readFileSync(fullPath, 'utf8')
}

async function main() {
  const files = fs.readdirSync(TARGET_DIR).filter(f => fs.statSync(path.join(TARGET_DIR, f)).isFile())
  console.log(`Embedding model: ${EMBED_MODEL}\n`)

  const rows = []

  for (const file of files) {
    const fullPath = path.join(TARGET_DIR, file)
    const content = await loadContent(file, fullPath)

    // BEFORE: old blind cut, source unknown -> always "upload"-like behavior
    const before = oldChunkText(content)
    const beforeVectors = await embed(before)

    // AFTER: adaptive router, source inferred from filename for the demo
    // (".log" -> planner_log, everything else -> upload)
    const source = file.endsWith('.log') ? 'planner_log' : 'upload'
    const strategyName = selectStrategy(source, content, {})
    const strategy = getStrategy(strategyName)
    const produced = strategy.chunk({ text: content, sourceType: source, metadata: {} })
    const afterChildren = produced.filter(c => !c.isParent)
    const afterParents = produced.filter(c => c.isParent)
    const afterVectors = await embed(afterChildren.map(c => c.text))

    console.log(`=== ${file} (${content.length} chars, source=${source}) ===`)
    console.log(`BEFORE (chunk.js, blind ~1200-char cut): ${before.length} chunk(s)`)
    before.forEach((c, i) => console.log(`  [${i}] ${c.length} chars, dim=${beforeVectors[i].length}`))
    console.log(`AFTER  (adaptive: ${strategyName}): ${afterChildren.length} chunk(s)${afterParents.length ? ` + ${afterParents.length} parent(s) (unembedded)` : ''}`)
    afterChildren.forEach((c, i) => console.log(`  [${i}] ${c.text.length} chars, dim=${afterVectors[i].length}`))
    console.log()

    rows.push({
      file,
      chars: content.length,
      source,
      beforeChunks: before.length,
      beforeAvgChars: Math.round(before.reduce((s, c) => s + c.length, 0) / before.length),
      strategy: strategyName,
      afterChunks: afterChildren.length,
      afterParents: afterParents.length,
      afterAvgChars: Math.round(afterChildren.reduce((s, c) => s + c.text.length, 0) / afterChildren.length),
    })
  }

  console.log('--- Summary ---')
  console.table(rows)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
