import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { recursiveSplit } = require('./recursive.js')

const CFG = { maxSize: 120 }

test('text under maxSize is not split', () => {
  const text = 'A short paragraph that fits easily.'
  const chunks = recursiveSplit(text, CFG)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], text)
})

test('markdown with headings produces chunks aligned to heading boundaries', () => {
  const text = [
    '# Heading One',
    'Some content under heading one that is reasonably long to fill space.',
    '## Heading Two',
    'Some content under heading two that is also reasonably long to fill space.',
  ].join('\n')

  const chunks = recursiveSplit(text, CFG)
  // every chunk should start at (or be entirely within) a single heading section —
  // i.e. a chunk never contains text from two different "# "/"## " headings unless
  // it was already small enough to not need splitting at all.
  const headingsPerChunk = chunks.map(c => (c.match(/^#{1,6}\s/gm) || []).length)
  for (const count of headingsPerChunk) assert.ok(count <= 1, 'chunk straddles two headings')
})

test('paragraphs are preferred over hard line/sentence splits when they fit', () => {
  const paragraphs = [
    'Paragraph one is short.',
    'Paragraph two is also short.',
  ]
  const text = paragraphs.join('\n\n')
  const chunks = recursiveSplit(text, { maxSize: 200 })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], text)
})

test('a piece still too big after all separators falls back to fixed_size hard-split', () => {
  const text = 'X'.repeat(1000)
  const chunks = recursiveSplit(text, CFG)
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.length <= CFG.maxSize)
})

test('empty input produces no chunks', () => {
  assert.deepEqual(recursiveSplit('', CFG), [])
})
