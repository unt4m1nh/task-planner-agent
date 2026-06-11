const { getToday } = require('../llm')
const { prepare, scoreTask } = require('./suggest')

const DEFAULT_START = '09:00'
const DEFAULT_END = '17:00'
const DEFAULT_TASK_MIN = 60
const MIN_BLOCK_MIN = 15
const BREAK_MIN = 10
const WORK_BEFORE_BREAK_MIN = 90
const GROUPING_SCORE_WINDOW = 5

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0')
  const m = String(min % 60).padStart(2, '0')
  return `${h}:${m}`
}

// Effective score = suggest score + workflow bonuses: finish in-progress work
// first, overdue next, and tasks already scheduled for the plan day up front.
function effectiveScore(task, date) {
  const { score } = scoreTask(task, {})
  let eff = score
  if (task.status === 'in_progress') eff += 50
  if (task.isOverdue) eff += 35
  if (task.status === 'scheduled' && task.dueDate === date) eff += 60
  return eff
}

// Among near-equal candidates, prefer one sharing a tag or source with the
// previous block to reduce context switching.
function pickNext(candidates, prevTask) {
  if (!prevTask) return 0
  const top = candidates[0]
  const idx = candidates.findIndex(c =>
    c.score >= top.score - GROUPING_SCORE_WINDOW &&
    (c.task.source === prevTask.source ||
      (c.task.tags || []).some(t => (prevTask.tags || []).includes(t)))
  )
  return idx === -1 ? 0 : idx
}

function planDay(tasks, { date, startTime, endTime, availableMinutes } = {}) {
  const planDate = date || getToday()
  const startMin = toMinutes(startTime || DEFAULT_START)
  const endMin = endTime
    ? toMinutes(endTime)
    : availableMinutes
      ? startMin + availableMinutes
      : toMinutes(DEFAULT_END)

  const candidates = tasks
    .map((t, storeIdx) => ({ task: prepare(t, planDate), storeIdx }))
    .filter(c => !c.task.isDone)
    .map(c => ({
      ...c,
      score: effectiveScore(c.task, planDate),
      durMin: Math.max(MIN_BLOCK_MIN, Math.round(c.task.remainMin ?? DEFAULT_TASK_MIN)),
    }))
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.storeIdx - b.storeIdx)

  const blocks = []
  let cursor = startMin
  let sinceBreak = 0
  let prevTask = null

  while (candidates.length && endMin - cursor >= MIN_BLOCK_MIN) {
    if (sinceBreak >= WORK_BEFORE_BREAK_MIN && endMin - cursor >= BREAK_MIN + MIN_BLOCK_MIN) {
      blocks.push({ start: toHHMM(cursor), end: toHHMM(cursor + BREAK_MIN), type: 'break' })
      cursor += BREAK_MIN
      sinceBreak = 0
    }

    const next = candidates.splice(pickNext(candidates, prevTask), 1)[0]
    const remaining = endMin - cursor
    const place = Math.min(next.durMin, remaining)
    const partial = next.durMin > remaining

    blocks.push({
      start: toHHMM(cursor),
      end: toHHMM(cursor + place),
      type: 'task',
      task: next.task,
      partial,
    })
    cursor += place
    sinceBreak += place
    prevTask = next.task
  }

  return {
    date: planDate,
    start: toHHMM(startMin),
    end: toHHMM(endMin),
    blocks,
    unplaced: candidates.map(c => c.task),
  }
}

module.exports = { planDay }
