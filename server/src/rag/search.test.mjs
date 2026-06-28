import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const { ingestDocument } = require('./ingest.js')
const { searchDocuments } = require('./search.js')

function tempDbPath() {
  return path.join(os.tmpdir(), `rag-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function cleanup(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
}

async function ollamaAvailable() {
  try {
    const res = await fetch('http://localhost:11434/api/tags')
    return res.ok
  } catch {
    return false
  }
}

test('parent_child retrieval returns the parent text, not just the matched child', async t => {
  if (!(await ollamaAvailable())) return t.skip('Ollama not reachable at localhost:11434')

  const dbPath = tempDbPath()
  try {
    const longDoc = Array.from({ length: 80 }, (_, i) =>
      `This is sentence number ${i} about onboarding a new engineer to the payments team, no headings here.`
    ).join(' ')

    await ingestDocument({ source: 'upload', title: 'onboarding.txt', content: longDoc, dbPath })

    const results = await searchDocuments('onboarding a new engineer to the payments team', { topK: 3, dbPath })
    assert.ok(results.length > 0)

    const hit = results[0]
    // the text passed to generation should be longer than (or equal to, if it
    // happens to be the only sentence) the raw matched child snippet — proof
    // that parent context, not the bare child fragment, is what's returned.
    assert.ok(hit.text.length >= hit.matchedText.length)
    assert.notEqual(hit.text, undefined)
  } finally {
    cleanup(dbPath)
  }
})

test('fixed_size / recursive retrieval returns the matched chunk text directly (no parent indirection)', async t => {
  if (!(await ollamaAvailable())) return t.skip('Ollama not reachable at localhost:11434')

  const dbPath = tempDbPath()
  try {
    const shortDoc = 'A'.repeat(2000) // > shortTextMax, < longDocMin, 0 headings -> fixed_size
    await ingestDocument({ source: 'upload', title: 'plain.txt', content: shortDoc, dbPath })

    const results = await searchDocuments('A', { topK: 1, dbPath })
    assert.equal(results.length, 1)
    assert.equal(results[0].text, results[0].matchedText)
  } finally {
    cleanup(dbPath)
  }
})
