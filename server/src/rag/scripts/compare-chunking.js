// Comparison script (adaptive chunking, DoD §9): shows a concrete retrieval
// difference between two chunking strategies on the same document.
//
// Ingests the same doc under two named strategies into a throwaway SQLite
// file (never the real rag.db), then runs the same question against each and
// prints the retrieved chunk side by side.
//
// Usage: node src/rag/scripts/compare-chunking.js <file> [question]
const fs = require('fs')
const path = require('path')
const os = require('os')
const { extractText } = require('../extract')
const { ingestDocument } = require('../ingest')
const { searchDocuments } = require('../search')

const STRATEGIES_TO_COMPARE = ['fixed_size', 'recursive']

async function loadContent(filePath) {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'pdf' || ext === 'docx') return extractText(fs.readFileSync(filePath), filePath)
  return fs.readFileSync(filePath, 'utf8')
}

function cleanup(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
}

async function main() {
  const [, , filePath, ...questionWords] = process.argv
  if (!filePath) {
    console.error('Usage: node src/rag/scripts/compare-chunking.js <file> [question]')
    process.exit(1)
  }

  const content = await loadContent(filePath)
  const question = questionWords.join(' ') || 'What is this document about?'
  const dbPath = path.join(os.tmpdir(), `rag-compare-${Date.now()}.db`)

  console.log(`Document: ${filePath} (${content.length} chars)`)
  console.log(`Question: "${question}"`)
  console.log(`Throwaway db: ${dbPath} (deleted on exit)\n`)

  try {
    for (const strategyName of STRATEGIES_TO_COMPARE) {
      console.log(`=== ${strategyName} ===`)

      const { chunkCount } = await ingestDocument({
        source: `compare_${strategyName}`,
        title: `${path.basename(filePath)} [${strategyName}]`,
        content,
        strategyOverride: strategyName,
        dbPath,
      })
      console.log(`chunks produced: ${chunkCount}`)

      const results = await searchDocuments(question, { topK: 1, source: `compare_${strategyName}`, dbPath })
      if (!results.length) {
        console.log('(no match)\n')
        continue
      }
      const top = results[0]
      console.log(`top match (distance ${top.distance.toFixed(4)}, ${top.text.length} chars):`)
      console.log(top.text)
      console.log()
    }
  } finally {
    cleanup(dbPath)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
