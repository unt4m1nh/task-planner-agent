'use strict'

const { BREAK_LADDER, BREAK_LADDER_DEFAULT_IDX } = require('./scheduler')

const DEFAULT_WORK_WINDOW = { start: '08:30', end: '17:30' }
const DEFAULT_LUNCH = { start: '12:00', end: '13:00', label: 'lunch' }

function defaultDayStructure() {
  return {
    workWindows: [{ ...DEFAULT_WORK_WINDOW }],
    fixedBlocks: [{ ...DEFAULT_LUNCH }],
    defaultBreak: BREAK_LADDER[BREAK_LADDER_DEFAULT_IDX],
  }
}

function defaultConstraints() {
  return {
    maxSessionLength: null,
    breakPolicy: null,  // null → use day.defaultBreak
    pinned: [],
    excluded: [],
  }
}

function breakLadderIdx(bp) {
  if (!bp) return 0
  for (let i = 1; i < BREAK_LADDER.length; i++) {
    const l = BREAK_LADDER[i]
    if (l && l.everyMinutes === bp.everyMinutes && l.durationMinutes === bp.durationMinutes) return i
  }
  return BREAK_LADDER_DEFAULT_IDX
}

/**
 * Apply an AdjustPatch to PlanConstraints → returns new PlanConstraints.
 */
function mergeConstraints(prev, patch) {
  const next = { ...prev }

  if ('setMaxSession' in patch) {
    next.maxSessionLength = patch.setMaxSession ?? null
  }

  if (patch.break) {
    const curIdx = breakLadderIdx(prev.breakPolicy)
    const newIdx =
      patch.break === 'more' ? Math.min(curIdx + 1, BREAK_LADDER.length - 1) :
      patch.break === 'less' ? Math.max(curIdx - 1, 0) :
      0  // 'off'
    next.breakPolicy = BREAK_LADDER[newIdx]
  }

  if (patch.pin?.length) {
    next.pinned = [...new Set([...(prev.pinned || []), ...patch.pin])]
  }

  if (patch.exclude?.length) {
    next.excluded = [...new Set([...(prev.excluded || []), ...patch.exclude])]
    next.pinned = (next.pinned || []).filter(id => !next.excluded.includes(id))
  }

  return next
}

/**
 * Apply swap/pin/exclude from patch to the ranked list.
 * Returns { ranked, clarification } — clarification is non-null when the removeId is invalid.
 */
function applyTaskDelta(ranked, patch, store) {
  if (!patch.swap && !patch.pin && !patch.exclude) return { ranked, clarification: null }

  let newRanked = [...ranked]

  // Handle exclude from patch
  if (patch.exclude?.length) {
    const excSet = new Set(patch.exclude)
    newRanked = newRanked.filter(t => !excSet.has(t.id))
  }

  // Handle swap
  if (patch.swap) {
    const { removeId, criteria } = patch.swap
    const removeIdx = newRanked.findIndex(t => t.id === removeId)
    if (removeIdx === -1) {
      return {
        ranked,
        clarification: `I couldn't find a scheduled task with id "${removeId}". Could you clarify which task to replace?`,
      }
    }
    newRanked.splice(removeIdx, 1)

    // Find replacement: the highest-ranked unscheduled task
    if (store) {
      const scheduledIds = new Set(newRanked.map(t => t.id))
      const allTasks = store.readTasks()
      const unscheduled = allTasks.filter(t => !scheduledIds.has(t.id) && t.status !== 'done')

      if (unscheduled.length) {
        let replacement
        if (criteria) {
          const { scoreTask, prepare } = require('./suggest')
          const { getToday } = require('../llm')
          const today = getToday()
          const scored = unscheduled
            .map(t => { const p = prepare(t, today); return { task: p, ...scoreTask(p, { preference: criteria }) } })
            .filter(r => !r.drop)
            .sort((a, b) => b.score - a.score)
          if (scored.length) replacement = scored[0].task
        } else {
          replacement = unscheduled[0]
        }
        if (replacement) newRanked.push(replacement)
      }
    }
  }

  return { ranked: newRanked, clarification: null }
}

/**
 * Apply a DayStructurePatch to DayStructure → returns new DayStructure.
 */
function applyDayStructurePatch(day, patch) {
  if (!patch) return day
  const next = {
    workWindows: (day.workWindows || []).map(w => ({ ...w })),
    fixedBlocks: [...(day.fixedBlocks || [])],
    defaultBreak: day.defaultBreak,
  }

  if (patch.setWorkWindow) {
    const { index, start, end } = patch.setWorkWindow
    if (index >= 0 && index < next.workWindows.length) {
      if (start) next.workWindows[index].start = start
      if (end)   next.workWindows[index].end   = end
    }
  }

  if (patch.addFixedBlock) {
    next.fixedBlocks.push({ ...patch.addFixedBlock })
    next.fixedBlocks.sort((a, b) => a.start.localeCompare(b.start))
  }

  if (patch.removeFixedBlockLabel) {
    next.fixedBlocks = next.fixedBlocks.filter(b => b.label !== patch.removeFixedBlockLabel)
  }

  return next
}

module.exports = {
  defaultDayStructure,
  defaultConstraints,
  mergeConstraints,
  applyTaskDelta,
  applyDayStructurePatch,
}
