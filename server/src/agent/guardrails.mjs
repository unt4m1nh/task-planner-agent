// Shared guardrails — deterministic content/safety/policy checks.
// No LLM calls. Same input → same verdict.
//
// Used at two levels:
//   1. Orchestrator (index.js): checkInput before routing, checkOutput before return
//   2. Individual agents: checkSchedule in plannerPlan (nodes-planner.mjs)
//
// Injection defense for RAG lives in agentic.js (agent-specific, not here).

export const CONFIG = {
  input: {
    maxLength: 4000,      // chars; blocks oversized user messages
  },
  steps: {
    MAX_ITERATIONS: 2,    // hard cap for any agent retrieval/rewrite loop
  },
  schedule: {
    workStartHour: 6,     // earliest allowed block start (inclusive)
    workEndHour: 22,      // latest allowed block end (inclusive)
  },
}

/**
 * @typedef {{ ok: true } | { ok: false; code: string; userMessage: string }} GuardResult
 */

/**
 * Checks a user message (or resume payload) before routing.
 * @param {string} text
 * @returns {GuardResult}
 */
export function checkInput(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      ok: false,
      code: 'INPUT_EMPTY',
      userMessage: "Please say something — I didn't receive any message.",
    }
  }
  if (text.length > CONFIG.input.maxLength) {
    return {
      ok: false,
      code: 'INPUT_TOO_LONG',
      userMessage: `Your message is too long (limit: ${CONFIG.input.maxLength} characters). Please shorten it.`,
    }
  }
  // Control-character soup: reject if more than 5 non-printable chars or >10% of message
  const controlChars = text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g)
  if (controlChars && (controlChars.length > 5 || controlChars.length / text.length > 0.1)) {
    return {
      ok: false,
      code: 'INPUT_GARBAGE',
      userMessage: "I received garbled input. Could you rephrase your request in plain text?",
    }
  }
  return { ok: true }
}

/**
 * Checks a response before returning it to the user.
 * Hard: any bracketed task ID in the text must exist in allTaskIds.
 * Soft: quoted figures/dates (log only — too many false positives to block).
 * @param {{ response?: string } | null} result
 * @param {{ allTaskIds?: Set<string> }} [context]
 * @returns {GuardResult}
 */
export function checkOutput(result, context = {}) {
  const response = result?.response ?? ''
  const { allTaskIds } = context

  if (allTaskIds && response) {
    const referenced = extractBracketedIds(response)
    const invalid = referenced.filter(id => !allTaskIds.has(id))
    if (invalid.length) {
      console.warn('[guardrails:output] response references unknown task ids:', invalid)
      return {
        ok: false,
        code: 'OUTPUT_INVALID_TASK_IDS',
        userMessage: "I couldn't verify some task references in my answer. Please check your task list and try again.",
      }
    }
  }

  return { ok: true }
}

/**
 * Validates a planner schedule before it is shown to the user.
 * Hard: no overlaps, no zero/negative durations, blocks within working-hour bounds.
 * On failure the caller should regenerate or fall back — not crash.
 * @param {{ blocks?: Array<{ start: string; end: string; kind?: string; type?: string; title?: string }> }} schedule
 * @returns {GuardResult}
 */
export function checkSchedule(schedule) {
  if (!schedule?.blocks?.length) return { ok: true }

  const { workStartHour, workEndHour } = CONFIG.schedule
  const timed = []

  for (const block of schedule.blocks) {
    const s = timeToMinutes(block.start)
    const e = timeToMinutes(block.end)
    if (s === null || e === null) continue

    if (e <= s) {
      return {
        ok: false,
        code: 'SCHEDULE_BAD_DURATION',
        userMessage: `Schedule contains a block with zero or negative duration (${block.start}–${block.end}). Please try again.`,
      }
    }
    if (s < workStartHour * 60 || e > workEndHour * 60) {
      return {
        ok: false,
        code: 'SCHEDULE_OUT_OF_BOUNDS',
        userMessage: `Schedule has blocks outside allowed working hours (${workStartHour}:00–${workEndHour}:00). Please try again.`,
      }
    }
    timed.push({ s, e })
  }

  // Overlap check: sort by start, flag if next starts before previous ends
  timed.sort((a, b) => a.s - b.s)
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].s < timed[i - 1].e) {
      return {
        ok: false,
        code: 'SCHEDULE_OVERLAP',
        userMessage: "Schedule has overlapping time blocks. Please try again.",
      }
    }
  }

  return { ok: true }
}

// ── internal helpers ────────────────────────────────────────────────────────

function timeToMinutes(t) {
  if (typeof t !== 'string') return null
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function extractBracketedIds(text) {
  const ids = []
  // Match [WORD-digits] and [manual-digits] patterns typical of task IDs
  const re = /\[([A-Za-z][A-Za-z0-9_]*-\d+)\]/g
  let m
  while ((m = re.exec(text)) !== null) ids.push(m[1])
  return [...new Set(ids)]
}
