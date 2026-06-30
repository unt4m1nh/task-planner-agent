import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeListFilter } from './nodes-router.mjs'

test('mergeListFilter composes a new field onto the prior filter (the §8 demo case)', () => {
  // Turn 1: "show me my todo tasks" -> {status: 'todo'}
  // Turn 2: "what about the high-priority ones?" -> continuation, new slot {priority: 'high'}
  const prev = { status: 'todo', priority: undefined, source: undefined, tags: undefined, query: undefined }
  const merged = mergeListFilter(prev, { intent: 'list', priority: 'high', continuation: true })
  assert.deepEqual(merged, { status: 'todo', priority: 'high', source: undefined, tags: undefined, query: undefined })
})

test('mergeListFilter overrides a field the new turn explicitly changes', () => {
  const prev = { priority: 'high', source: 'jira' }
  const merged = mergeListFilter(prev, { priority: 'low' })
  assert.deepEqual(merged, { priority: 'low', source: 'jira' })
})

test('mergeListFilter with no prior filter just keeps the new slots', () => {
  const merged = mergeListFilter(null, { priority: 'high' })
  assert.deepEqual(merged, { priority: 'high' })
})

test('mergeListFilter with no new fields keeps the prior filter unchanged', () => {
  const prev = { status: 'todo', priority: 'high' }
  const merged = mergeListFilter(prev, { intent: 'list', continuation: true })
  assert.deepEqual(merged, prev)
})
