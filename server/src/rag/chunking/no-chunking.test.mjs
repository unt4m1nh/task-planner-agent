import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { noChunkingStrategy } = require('./no-chunking.js')

const strategy = noChunkingStrategy()

test('no_chunking returns exactly one chunk equal to the trimmed input', () => {
  const chunks = strategy.chunk({ text: '  Hello world.  \n' })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, 'Hello world.')
})

test('no_chunking returns nothing for empty/whitespace input', () => {
  assert.equal(strategy.chunk({ text: '' }).length, 0)
  assert.equal(strategy.chunk({ text: '   \n  ' }).length, 0)
})

test('no_chunking never splits a long input', () => {
  const longText = 'A'.repeat(5000)
  const chunks = strategy.chunk({ text: longText })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, longText)
})
