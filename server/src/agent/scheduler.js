'use strict'

const DEFAULT_TASK_MINUTES = 30

// Break ladder: index 0 = off, 1 = light (default), 2 = more, 3 = most
const BREAK_LADDER = [
  null,
  { everyMinutes: 90, durationMinutes: 10 },
  { everyMinutes: 60, durationMinutes: 10 },
  { everyMinutes: 45, durationMinutes: 15 },
]
const BREAK_LADDER_DEFAULT_IDX = 1

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

// Compute free intervals: workWindows minus fixedBlocks
function freeIntervals(workWindows, fixedBlocks) {
  const fixed = (fixedBlocks || [])
    .map(b => ({ start: toMin(b.start), end: toMin(b.end) }))
    .sort((a, b) => a.start - b.start)

  const intervals = []
  for (const w of (workWindows || [])) {
    let cursor = toMin(w.start)
    const wEnd = toMin(w.end)
    const blockers = fixed.filter(b => b.start < wEnd && b.end > cursor)
    for (const blocker of blockers) {
      if (blocker.start > cursor) intervals.push({ start: cursor, end: blocker.start })
      cursor = Math.max(cursor, blocker.end)
    }
    if (cursor < wEnd) intervals.push({ start: cursor, end: wEnd })
  }
  return intervals
}

/**
 * Pure deterministic scheduler.
 *
 * @param {object[]} rankedTasks  Already-ranked Task list (highest priority first).
 * @param {object}   day          DayStructure: { workWindows, fixedBlocks, defaultBreak }
 * @param {object}   constraints  PlanConstraints: { maxSessionLength, breakPolicy, pinned, excluded }
 * @param {object}   [ctx]        Context (unused by pure fn; reserved for future ctx.now support)
 * @returns {{ blocks: object[], dropped: object[] }}
 */
function scheduler(rankedTasks, day, constraints, ctx) {
  const { pinned = [], excluded = [], breakPolicy, maxSessionLength } = constraints || {}
  const fixedBlocks = day.fixedBlocks || []

  // The break policy in effect: explicit constraint > day.defaultBreak > null
  const bp = breakPolicy !== undefined ? breakPolicy : (day.defaultBreak ?? null)

  const excl = new Set(excluded)
  const pins = new Set(pinned)
  const available = (rankedTasks || []).filter(t => !excl.has(t.id))
  const ordered = [
    ...available.filter(t => pins.has(t.id)),
    ...available.filter(t => !pins.has(t.id)),
  ]

  // Mutable slot cursors with per-slot work accumulator
  const slots = freeIntervals(day.workWindows || [], fixedBlocks)
    .map(s => ({ start: s.start, end: s.end, workAccum: 0 }))

  const outBlocks = []
  const dropped = []

  for (const task of ordered) {
    const remainHours = task.estimate_hours != null
      ? Math.max(0, task.estimate_hours - (task.logged_hours ?? 0))
      : null
    const totalMin = remainHours != null ? Math.round(remainHours * 60) : DEFAULT_TASK_MINUTES
    const isEst = task.estimate_hours == null

    // Split task into sessions if maxSessionLength is set
    const sessions = []
    if (maxSessionLength && totalMin > maxSessionLength) {
      let rem = totalMin
      while (rem > 0) { sessions.push(Math.min(rem, maxSessionLength)); rem -= maxSessionLength }
    } else {
      sessions.push(totalMin)
    }

    let allPlaced = true
    for (const sessionMin of sessions) {
      let placed = false

      for (const slot of slots) {
        // If a break is due in this slot, try to insert it
        if (bp && slot.workAccum >= bp.everyMinutes) {
          const breakEnd = slot.start + bp.durationMinutes
          if (breakEnd <= slot.end) {
            outBlocks.push({ start: toHHMM(slot.start), end: toHHMM(breakEnd), kind: 'break' })
            slot.start = breakEnd
            slot.workAccum = 0
          } else {
            continue  // break doesn't fit — skip slot
          }
        }

        const avail = slot.end - slot.start
        if (avail < sessionMin) continue

        outBlocks.push({
          start: toHHMM(slot.start),
          end: toHHMM(slot.start + sessionMin),
          kind: 'task',
          task,
          isEst,
        })
        slot.start += sessionMin
        slot.workAccum += sessionMin
        placed = true
        break
      }

      if (!placed) { allPlaced = false; break }
    }

    if (!allPlaced) {
      dropped.push({ taskId: task.id, title: task.title, reason: 'no free slot in window' })
    }
  }

  // Merge fixed blocks and sort all by start time
  const fixedOut = fixedBlocks.map(b => ({ start: b.start, end: b.end, kind: 'fixed', label: b.label }))
  const allBlocks = [...outBlocks, ...fixedOut].sort((a, b) => toMin(a.start) - toMin(b.start))

  return { blocks: allBlocks, dropped }
}

module.exports = { scheduler, BREAK_LADDER, BREAK_LADDER_DEFAULT_IDX, DEFAULT_TASK_MINUTES, freeIntervals }
