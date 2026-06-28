import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { parentChildSplit } = require('./parent-child.js')

const CFG = { parentMaxSize: 300, childTargetSize: 60, childOverlapSize: 10 }

function longDoc() {
  return Array.from({ length: 20 }, (_, i) =>
    `This is sentence number ${i} in a fairly long document with no headings at all.`
  ).join(' ')
}

test('every child has a resolvable parentLocalId', () => {
  const produced = parentChildSplit(longDoc(), CFG)
  const parentIds = new Set(produced.filter(c => c.isParent).map(c => c.parentLocalId))
  const children = produced.filter(c => !c.isParent)
  assert.ok(children.length > 0)
  for (const child of children) {
    assert.ok(parentIds.has(child.parentLocalId), `child has unresolvable parentLocalId ${child.parentLocalId}`)
  }
})

test('parents are flagged isParent, children are not', () => {
  const produced = parentChildSplit(longDoc(), CFG)
  for (const piece of produced) {
    if (piece.isParent) assert.equal(piece.isParent, true)
    else assert.ok(!piece.isParent)
  }
})

test('child sizes are <= parent sizes', () => {
  const produced = parentChildSplit(longDoc(), CFG)
  const parentsByLocalId = new Map(produced.filter(c => c.isParent).map(c => [c.parentLocalId, c.text]))
  for (const child of produced.filter(c => !c.isParent)) {
    const parentText = parentsByLocalId.get(child.parentLocalId)
    assert.ok(child.text.length <= parentText.length)
  }
})

test('at least one parent and multiple children for a long document', () => {
  const produced = parentChildSplit(longDoc(), CFG)
  assert.ok(produced.filter(c => c.isParent).length >= 1)
  assert.ok(produced.filter(c => !c.isParent).length > 1)
})
