import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import fs from 'fs'

const require = createRequire(import.meta.url)
const { ingestDocument } = require('./ingest.js')
const { getDb } = require('./db.js')

// Integration tests hit the real bge-m3 model via Ollama (no mocking, per
// project convention — see CLAUDE.md). They use a throwaway db file so the
// real rag.db corpus is never touched, and they skip gracefully if Ollama
// isn't running rather than failing the whole suite.

function tempDbPath() {
  return path.join(os.tmpdir(), `rag-ingest-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function cleanup(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true })
  }
}

async function ollamaAvailable() {
  try {
    const res = await fetch('http://localhost:11434/api/tags')
    return res.ok
  } catch {
    return false
  }
}

test('ingest planner_log -> exactly one no_chunking row, embedded summary only', async t => {
  if (!(await ollamaAvailable())) return t.skip('Ollama not reachable at localhost:11434')

  const dbPath = tempDbPath()
  try {
    const { documentId, strategy, chunkCount } = await ingestDocument({
      source: 'planner_log',
      title: 'Daily plan 2026-06-27',
      content: 'Daily plan for 2026-06-27 (09:00-17:00):\n\n09:00-10:00 Fix login bug',
      dbPath,
    })
    assert.equal(strategy, 'no_chunking')
    assert.equal(chunkCount, 1)

    const db = getDb(dbPath)
    const rows = db.prepare('SELECT * FROM chunks WHERE document_id = ?').all(documentId)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].strategy, 'no_chunking')
    assert.equal(rows[0].is_parent, 0)
    assert.equal(rows[0].parent_id, null)

    const vecRows = db.prepare('SELECT rowid FROM vec_chunks').all()
    assert.equal(vecRows.length, 1)
  } finally {
    cleanup(dbPath)
  }
})

test('ingest a long dense doc -> parent rows unembedded, child rows embedded with parent_id set', async t => {
  if (!(await ollamaAvailable())) return t.skip('Ollama not reachable at localhost:11434')

  const dbPath = tempDbPath()
  try {
    const longDoc = Array.from({ length: 80 }, (_, i) =>
      `This is sentence number ${i} in a long document with no markdown headings at all, just plain prose.`
    ).join(' ')

    const { documentId, strategy } = await ingestDocument({
      source: 'upload',
      title: 'long-dense.txt',
      content: longDoc,
      dbPath,
    })
    assert.equal(strategy, 'parent_child')

    const db = getDb(dbPath)
    const parents = db.prepare('SELECT * FROM chunks WHERE document_id = ? AND is_parent = 1').all(documentId)
    const children = db.prepare('SELECT * FROM chunks WHERE document_id = ? AND is_parent = 0').all(documentId)
    assert.ok(parents.length >= 1)
    assert.ok(children.length > parents.length)
    for (const child of children) {
      assert.ok(parents.some(p => p.id === child.parent_id), 'child parent_id does not resolve to a parent row')
    }

    // vec index must contain children only
    const vecCount = db.prepare('SELECT COUNT(*) AS n FROM vec_chunks').get().n
    assert.equal(vecCount, children.length)
  } finally {
    cleanup(dbPath)
  }
})

test('ingest a structured markdown doc -> recursive rows aligned to heading boundaries', async t => {
  if (!(await ollamaAvailable())) return t.skip('Ollama not reachable at localhost:11434')

  const dbPath = tempDbPath()
  try {
    const text = [
      '# Section One',
      'Body text for section one. '.repeat(20),
      '## Section Two',
      'Body text for section two. '.repeat(20),
      '### Section Three',
      'Body text for section three. '.repeat(20),
    ].join('\n')

    const { documentId, strategy } = await ingestDocument({
      source: 'upload',
      title: 'structured.md',
      content: text,
      dbPath,
    })
    assert.equal(strategy, 'recursive')

    const db = getDb(dbPath)
    const rows = db.prepare('SELECT * FROM chunks WHERE document_id = ?').all(documentId)
    for (const row of rows) {
      const headingCount = (row.text.match(/^#{1,6}\s/gm) || []).length
      assert.ok(headingCount <= 1, `chunk straddles two headings: ${row.text.slice(0, 60)}`)
    }
  } finally {
    cleanup(dbPath)
  }
})
