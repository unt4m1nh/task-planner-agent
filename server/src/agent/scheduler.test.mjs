import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { scheduler, BREAK_LADDER } = require('./scheduler.js')

const DEFAULT_DAY = {
  workWindows: [{ start: '09:00', end: '17:00' }],
  fixedBlocks: [{ start: '12:00', end: '13:00', label: 'lunch' }],
  defaultBreak: null,
}

function task(id, title, estimateH, loggedH = 0, priority = 'medium') {
  return { id, title, priority, estimate_hours: estimateH, logged_hours: loggedH, status: 'todo', source: 'manual', tags: [] }
}

function blocks(sched) { return sched.blocks.filter(b => b.kind === 'task') }
function dropped(sched) { return sched.dropped }
function breakBlocks(sched) { return sched.blocks.filter(b => b.kind === 'break') }
function fixedBlocks(sched) { return sched.blocks.filter(b => b.kind === 'fixed') }

// ── happy path: single task fits ─────────────────────────────────────────────
test('places a task that fits in the morning session', () => {
  const t1 = task('t1', 'Write tests', 1)
  const sched = scheduler([t1], DEFAULT_DAY, {})
  const tb = blocks(sched)
  assert.equal(tb.length, 1)
  assert.equal(tb[0].start, '09:00')
  assert.equal(tb[0].end,   '10:00')
  assert.equal(tb[0].task.id, 't1')
  assert.equal(dropped(sched).length, 0)
})

// ── fixed blocks always appear ────────────────────────────────────────────────
test('lunch always present in output as fixed block', () => {
  const sched = scheduler([], DEFAULT_DAY, {})
  const fb = fixedBlocks(sched)
  assert.equal(fb.length, 1)
  assert.equal(fb[0].label, 'lunch')
  assert.equal(fb[0].start, '12:00')
  assert.equal(fb[0].end, '13:00')
})

// ── overload → dropped ────────────────────────────────────────────────────────
test('tasks that do not fit are added to dropped', () => {
  // 8-hour task, day has 7h of work (09-12, 13-17)
  const t1 = task('t1', 'Giant task', 8)
  const sched = scheduler([t1], DEFAULT_DAY, {})
  assert.equal(blocks(sched).length, 0)
  assert.equal(dropped(sched).length, 1)
  assert.equal(dropped(sched)[0].taskId, 't1')
  assert.equal(dropped(sched)[0].reason, 'no free slot in window')
})

// ── maxSessionLength split ────────────────────────────────────────────────────
test('maxSessionLength splits a 4h task into 2h sessions', () => {
  const t1 = task('t1', 'Long task', 4)
  const sched = scheduler([t1], DEFAULT_DAY, { maxSessionLength: 120 })
  const tb = blocks(sched)
  // freeIntervals: [09:00-12:00 (180min), 13:00-17:00 (240min)]
  // session1=120 → 09:00-11:00 (slot1 has 60min left, not enough for session2)
  // session2=120 → 13:00-15:00 (slot2 has 240min)
  assert.equal(tb.length, 2)
  assert.equal(tb[0].start, '09:00'); assert.equal(tb[0].end, '11:00')
  assert.equal(tb[1].start, '13:00'); assert.equal(tb[1].end, '15:00')
  assert.equal(dropped(sched).length, 0)
})

// ── break insertion ───────────────────────────────────────────────────────────
test('break is inserted after everyMinutes of work', () => {
  const bp = BREAK_LADDER[1]  // { everyMinutes: 90, durationMinutes: 10 }
  // Two 1h tasks: t1 places at 09-10 (60min), t2 at 10-11 (60min, now 120min > 90)
  // Before t2 a break should be inserted
  const t1 = task('t1', 'Task A', 1)
  const t2 = task('t2', 'Task B', 1)
  const sched = scheduler([t1, t2], DEFAULT_DAY, { breakPolicy: bp })
  // t1: 09-10, workAccum=60. t2: check 60 < 90 → no break yet. Place at 10-11, workAccum=120.
  // Wait — break fires BEFORE placing, when workAccum >= everyMinutes.
  // After t1: workAccum=60. Before t2: 60 < 90 → no break. Place t2 at 10-11.
  // So we'd need a 3rd task to trigger the break. Let's add one.
  const t3 = task('t3', 'Task C', 1)
  const sched2 = scheduler([t1, t2, t3], DEFAULT_DAY, { breakPolicy: bp })
  // After t1+t2: workAccum=120. Before t3: 120 >= 90 → insert break.
  const bb = breakBlocks(sched2)
  assert.equal(bb.length >= 1, true, 'should have at least one break')
})

// ── pinned tasks placed first ─────────────────────────────────────────────────
test('pinned tasks are placed before unpinned', () => {
  const t1 = task('t1', 'Normal', 1)
  const t2 = task('t2', 'Pinned', 1)
  // t1 is ranked first but t2 is pinned → t2 placed first
  const sched = scheduler([t1, t2], DEFAULT_DAY, { pinned: ['t2'] })
  const tb = blocks(sched)
  assert.equal(tb[0].task.id, 't2')
  assert.equal(tb[1].task.id, 't1')
})

// ── excluded tasks skipped ────────────────────────────────────────────────────
test('excluded tasks are not placed', () => {
  const t1 = task('t1', 'Normal', 1)
  const t2 = task('t2', 'Excluded', 1)
  const sched = scheduler([t1, t2], DEFAULT_DAY, { excluded: ['t2'] })
  const tb = blocks(sched)
  assert.equal(tb.length, 1)
  assert.equal(tb[0].task.id, 't1')
})

// ── null estimate_hours → default duration ─────────────────────────────────────
test('null estimate_hours uses DEFAULT_TASK_MINUTES and marks isEst', () => {
  const t1 = { id: 't1', title: 'Unknown', estimate_hours: null, logged_hours: 0, status: 'todo', source: 'manual', tags: [] }
  const sched = scheduler([t1], DEFAULT_DAY, {})
  const tb = blocks(sched)
  assert.equal(tb.length, 1)
  assert.equal(tb[0].isEst, true)
  // default = 30 min → 09:00-09:30
  assert.equal(tb[0].start, '09:00')
  assert.equal(tb[0].end,   '09:30')
})

// ── blocks sorted by start time ───────────────────────────────────────────────
test('output blocks are sorted by start time', () => {
  const tasks = [task('t1', 'A', 1), task('t2', 'B', 0.5)]
  const sched = scheduler(tasks, DEFAULT_DAY, {})
  const starts = sched.blocks.map(b => b.start)
  const sorted = [...starts].sort()
  assert.deepEqual(starts, sorted)
})
