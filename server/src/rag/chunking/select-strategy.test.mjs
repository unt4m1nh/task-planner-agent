import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { selectStrategy } = require('./select-strategy.js')

test('planner_log (any length) -> no_chunking', () => {
  assert.equal(selectStrategy('planner_log', 'short'), 'no_chunking')
  assert.equal(selectStrategy('planner_log', 'X'.repeat(9000)), 'no_chunking')
})

test('200-char doc -> no_chunking', () => {
  assert.equal(selectStrategy('upload', 'A'.repeat(200)), 'no_chunking')
})

test('markdown with 3 headings -> recursive', () => {
  const text = ['# H1', 'body '.repeat(300), '## H2', 'more body', '### H3', 'even more body'].join('\n')
  assert.ok(text.length >= 1000)
  assert.equal(selectStrategy('upload', text), 'recursive')
})

test('6000-char doc, 0 headings -> parent_child', () => {
  const text = 'A'.repeat(6000)
  assert.equal(selectStrategy('upload', text), 'parent_child')
})

test('2000-char doc, 0 headings -> fixed_size', () => {
  const text = 'A'.repeat(2000)
  assert.equal(selectStrategy('upload', text), 'fixed_size')
})

test('same input twice -> identical output (determinism)', () => {
  const text = 'A'.repeat(6000)
  const first = selectStrategy('upload', text)
  const second = selectStrategy('upload', text)
  assert.equal(first, second)
})
