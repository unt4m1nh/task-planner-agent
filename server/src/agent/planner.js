const { getToday } = require('../llm')
const { prepare, scoreTask } = require('./suggest')

const DEFAULT_START = '08:30'
const DEFAULT_END   = '17:30'
const DEFAULT_TASK_MIN  = 60
const WORK_MIN          = 30   // minimum work block (non-meetings)
const MEETING_MIN       = 15   // minimum meeting block
const BLOCK_GRANULARITY = 30   // work blocks are multiples of this
const BREAK_DUR         = 15   // short break duration
const BREAK_EVERY       = 90   // insert break after this many consecutive work minutes
const LUNCH_START_MIN   = 12 * 60   // 720
const LUNCH_END_MIN     = 13 * 60   // 780
const LUNCH_DUR         = 60

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0')
  const m = String(min % 60).padStart(2, '0')
  return `${h}:${m}`
}

function isMeeting(task) {
  return task.source === 'google_calendar' || (task.tags || []).includes('meeting')
}

// Round up raw minutes to nearest 30-min multiple; enforce minimum
function snapDur(raw, meeting) {
  if (meeting) return Math.max(MEETING_MIN, raw)
  const snapped = Math.ceil(raw / BLOCK_GRANULARITY) * BLOCK_GRANULARITY
  return Math.max(WORK_MIN, snapped)
}

function effectiveScore(task, date, workMinutes) {
  const { score } = scoreTask(task, {})
  let eff = score
  if (task.status === 'in_progress') eff += 50
  if (task.isOverdue)                eff += 35
  if (task.status === 'scheduled' && task.dueDate === date) eff += 60
  // Multi-session bonus: large tasks that exceed the whole available work window
  // → prefer the one with MORE remaining time
  const remain = task.remainMin
  if (remain != null && remain > workMinutes) {
    eff += Math.min(20, Math.floor(remain / 60) * 2)
  }
  return eff
}

function planDay(tasks, { date, startTime, endTime, availableMinutes } = {}) {
  const planDate = date || getToday()
  const startMin = toMinutes(startTime || DEFAULT_START)
  const endMin   = endTime
    ? toMinutes(endTime)
    : availableMinutes
      ? startMin + availableMinutes
      : toMinutes(DEFAULT_END)

  // Insert a fixed 1-hour lunch (12:00–13:00) when the window spans noon
  const hasLunch = startMin < LUNCH_START_MIN && endMin > LUNCH_END_MIN
  const workMinutes = (endMin - startMin) - (hasLunch ? LUNCH_DUR : 0)

  const candidates = tasks
    .map((t, storeIdx) => ({ task: prepare(t, planDate), storeIdx }))
    .filter(c => !c.task.isDone)
    .map(c => {
      const meeting = isMeeting(c.task)
      const rawMin  = Math.round(c.task.remainMin ?? DEFAULT_TASK_MIN)
      return {
        ...c,
        meeting,
        score:  effectiveScore(c.task, planDate, workMinutes),
        durMin: snapDur(rawMin, meeting),
      }
    })
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.storeIdx - b.storeIdx)

  const blocks    = []
  let cursor      = startMin
  let sinceBreak  = 0
  let lunchDone   = !hasLunch

  while (candidates.length) {
    // ── Lunch ────────────────────────────────────────────────────────────────
    if (!lunchDone && cursor >= LUNCH_START_MIN) {
      blocks.push({
        start: toHHMM(LUNCH_START_MIN),
        end:   toHHMM(LUNCH_END_MIN),
        type:  'break',
        label: 'lunch',
      })
      cursor     = LUNCH_END_MIN
      sinceBreak = 0
      lunchDone  = true
      continue
    }

    // ── Available time in the current session (morning or afternoon) ─────────
    const sessionEnd = (!lunchDone) ? LUNCH_START_MIN : endMin
    const available  = sessionEnd - cursor

    // ── Short break ──────────────────────────────────────────────────────────
    // Lunch (12:00–13:00) is independent: never place a break immediately
    // adjacent to it. sinceBreak resets to 0 at lunch, so the after-lunch
    // case is impossible; the before-lunch guard below covers the other side.
    const breakWouldAbutLunch = !lunchDone && (cursor + BREAK_DUR >= LUNCH_START_MIN)
    if (sinceBreak >= BREAK_EVERY && available >= BREAK_DUR + WORK_MIN && !breakWouldAbutLunch) {
      blocks.push({ start: toHHMM(cursor), end: toHHMM(cursor + BREAK_DUR), type: 'break' })
      cursor     += BREAK_DUR
      sinceBreak  = 0
      continue
    }

    const next     = candidates[0]
    const minBlock = next.meeting ? MEETING_MIN : WORK_MIN

    // ── Not enough room in this session → jump to next session or stop ───────
    if (available < minBlock) {
      if (!lunchDone) { cursor = LUNCH_START_MIN; continue }
      break
    }

    // ── Compute block size ───────────────────────────────────────────────────
    let place = Math.min(next.durMin, available)
    if (!next.meeting) {
      place = Math.floor(place / BLOCK_GRANULARITY) * BLOCK_GRANULARITY
      if (place < WORK_MIN) {
        if (!lunchDone) { cursor = LUNCH_START_MIN; continue }
        break
      }
    }

    // If this task gets interrupted by lunch, put remaining back at front of queue
    const cutAtLunch = !lunchDone && next.durMin > place && sessionEnd === LUNCH_START_MIN
    candidates.shift()
    if (cutAtLunch) {
      const afterDur = next.durMin - place
      if (afterDur >= (next.meeting ? MEETING_MIN : WORK_MIN)) {
        candidates.unshift({ ...next, durMin: afterDur })
      }
    }

    blocks.push({
      start:   toHHMM(cursor),
      end:     toHHMM(cursor + place),
      type:    'task',
      task:    next.task,
      partial: next.durMin > place,
    })
    cursor    += place
    sinceBreak += next.meeting ? 0 : place
  }

  return {
    date:     planDate,
    start:    toHHMM(startMin),
    end:      toHHMM(endMin),
    blocks,
    unplaced: candidates.map(c => c.task),
  }
}

module.exports = { planDay }
