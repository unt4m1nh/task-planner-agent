// Manual test: chunking + bge-m3 embedding over files in docs/test-chunk
// Run from server/: node src/rag/test-embed-chunk.js
const fs = require('fs')
const path = require('path')
const { chunkText } = require('./chunk')
const { embed, EMBED_MODEL } = require('./embeddings')
const { extractText } = require('./extract')

const TARGET_DIR = path.resolve(__dirname, '../../../docs/test-chunk')

async function main() {
  const files = fs.readdirSync(TARGET_DIR).filter(f => fs.statSync(path.join(TARGET_DIR, f)).isFile())
  if (!files.length) {
    console.log(`No files found in ${TARGET_DIR}`)
    return
  }

  console.log(`Embedding model: ${EMBED_MODEL}`)
  console.log(`Files found: ${files.join(', ')}\n`)

  for (const file of files) {
    const fullPath = path.join(TARGET_DIR, file)
    const ext = file.toLowerCase().split('.').pop()
    let content
    if (ext === 'pdf' || ext === 'docx') {
      content = await extractText(fs.readFileSync(fullPath), file)
    } else {
      content = fs.readFileSync(fullPath, 'utf8')
    }
    const chunks = chunkText(content)

    console.log(`=== ${file} ===`)
    console.log(`content length: ${content.length} chars -> ${chunks.length} chunk(s)\n`)

    let vectors
    try {
      vectors = await embed(chunks)
    } catch (err) {
      console.error(`  embed() failed: ${err.message}`)
      continue
    }

    chunks.forEach((chunk, i) => {
      const vec = vectors[i]
      console.log(`--- chunk ${i} (${chunk.length} chars, embedding dim=${vec.length}) ---`)
      console.log(chunk.slice(0, 200) + (chunk.length > 200 ? '...' : ''))
      console.log(`embedding preview: [${vec.slice(0, 5).map(n => n.toFixed(4)).join(', ')}, ...]\n`)
    })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
