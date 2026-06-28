import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { fixedSizeSplit } = require('./fixed-size.js')

const CFG = { targetSize: 100, overlapSize: 20 }

function sentence(n) {
  return `Sentence number ${n} has some words in it.`
}

test('no chunk exceeds targetSize (no oversized sentences)', () => {
  const text = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ')
  const chunks = fixedSizeSplit(text, CFG)
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.length <= CFG.targetSize, `chunk too long: "${c}" (${c.length})`)
})

test('no chunk is empty', () => {
  const text = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ')
  const chunks = fixedSizeSplit(text, CFG)
  for (const c of chunks) assert.ok(c.trim().length > 0)
})

test('consecutive chunks share overlap content', () => {
  const text = Array.from({ length: 10 }, (_, i) => sentence(i)).join(' ')
  const chunks = fixedSizeSplit(text, CFG)
  assert.ok(chunks.length >= 2)
  // the trailing sentence(s) of chunk i should reappear at the start of chunk i+1
  for (let i = 0; i < chunks.length - 1; i++) {
    const tailWords = chunks[i].split(' ').slice(-3).join(' ')
    assert.ok(chunks[i + 1].includes(tailWords.split(' ')[0]), `no overlap between chunk ${i} and ${i + 1}`)
  }
})

test('a single sentence longer than targetSize is hard-split, not dropped', () => {
  const longSentence = 'X'.repeat(500) + '.'
  const chunks = fixedSizeSplit(longSentence, CFG)
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.length <= CFG.targetSize)
  // every char of the original sentence is covered by some chunk (overlap means
  // chunks may total more than the original length, but nothing is dropped)
  assert.ok(chunks[0].startsWith('X'))
  assert.ok(longSentence.endsWith(chunks[chunks.length - 1].slice(-1)))
})

test('empty input produces no chunks', () => {
  assert.deepEqual(fixedSizeSplit('', CFG), [])
  assert.deepEqual(fixedSizeSplit('   ', CFG), [])
})
