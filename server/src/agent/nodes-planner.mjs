import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import path from 'path'
import { interrupt } from '@langchain/langgraph'
import { lastUserMsg, agentLog, fmtPlanText } from './utils.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const { generate } = require('../llm.js')
const store = require('../store.js')
const { suggestTasks } = require('./suggest.js')
const { rankTasksForDay } = require('./planner.js')
const { scheduler, freeIntervals } = require('./scheduler.js')
const planAdjust = require('./plan-adjust.js')
const { adjustPatchOllamaSchema, validateAdjustPatch } = require('./schema.js')

const ADJUST_SKILL = readFileSync(
  path.resolve(__dirname, './adjust-plan/SKILL.md'), 'utf8'
).replace(/^---[\s\S]*?---\n/, '')


export async function plannerUnderstand(state) {
  const slots = state.plannerSlots
  if (!slots?.intent) {
    agentLog('planner_understand', { subIntent: 'unknown' })
    return { result: { intent: 'unknown', response: 'Could not determine planner intent.' } }
  }

  const ctx = state.sessionContext || {}

  let subIntent = slots.intent === 'suggest' ? 'rank'
    : slots.intent === 'plan' ? 'plan'
      : slots.intent === 'reorder' ? 'reorder'
        : slots.intent

  const hasPriorPlan = !!(ctx.lastPlanText || ctx.planSchedule)
  const hasPriorSchedule = !!(ctx.lastSchedule || ctx.planSchedule)

  const msg = lastUserMsg(state)
  const COMPLETE_RE = /\b(complet|finish|done|all done|wrap|wrapped|worked through|executed)\b/i
  const PLAN_RE = /\b(plan|schedule|day|today|tasks?)\b/i
  const isCompleteIntent = hasPriorSchedule && COMPLETE_RE.test(msg) && PLAN_RE.test(msg)
  if (isCompleteIntent) subIntent = 'complete'

  const isPlanModification = !isCompleteIntent && hasPriorPlan && (slots.contextFallback || subIntent === 'rank')
  if (isPlanModification) subIntent = 'plan'

  const isFollowUp = isPlanModification || (subIntent === 'plan' && hasPriorPlan)
  const planFeedback = isFollowUp ? msg : null

  const allTasks = store.readTasks()
  agentLog('planner_understand', { subIntent, tasks: allTasks.length, followUp: isFollowUp })
  return {
    tasks: allTasks,
    plannerSlots: {
      ...slots,
      subIntent,
      ...(planFeedback ? { planFeedback } : {}),
    },
  }
}

export async function plannerRank(state) {
  const { mood, preference, availableMinutes } = state.plannerSlots || {}
  agentLog('planner_rank', { mood, preference, availableMinutes })
  if (!availableMinutes && !mood && !preference) {
    return {
      result: {
        intent: 'suggest',
        response: "To suggest the best task, tell me your situation — minutes available, how you're feeling, or what kind of task you want.",
      },
    }
  }
  const text = suggestTasks({ mood, preference, availableMinutes })
  return {
    result: { intent: 'suggest', response: text },
    sessionContext: { activeIntent: 'suggest', lastPlanText: null, lastSchedule: null },
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildDayStructure(slots, defaults) {
  const day = {
    workWindows: [{ ...defaults.workWindows[0] }],
    fixedBlocks: [...defaults.fixedBlocks],
    defaultBreak: defaults.defaultBreak,
  }
  if (slots.startTime) day.workWindows[0].start = slots.startTime
  if (slots.endTime)   day.workWindows[0].end   = slots.endTime
  if (slots.availableMinutes && !slots.endTime) {
    const [h, m] = day.workWindows[0].start.split(':').map(Number)
    const endMin = h * 60 + m + slots.availableMinutes
    day.workWindows[0].end = `${String(Math.floor(endMin / 60)).padStart(2,'0')}:${String(endMin % 60).padStart(2,'0')}`
  }
  return day
}

function enrichSchedule(sched, day, planDate) {
  return {
    date:  planDate,
    start: day.workWindows[0].start,
    end:   day.workWindows[day.workWindows.length - 1].end,
    blocks: sched.blocks,
    dropped: sched.dropped,
  }
}

// ── GENERATE flow ─────────────────────────────────────────────────────────────

async function runGenerate(state, allTasks) {
  const slots = state.plannerSlots || {}
  const { getToday } = require('../llm.js')
  const planDate = slots.date || getToday()

  const defaultDay = planAdjust.defaultDayStructure()
  const day = buildDayStructure(slots, defaultDay)
  const constraints = planAdjust.defaultConstraints()

  // Compute available work minutes for scoring bonus
  const workMin = freeIntervals(day.workWindows, day.fixedBlocks).reduce((s, iv) => s + (iv.end - iv.start), 0)

  const ranked = rankTasksForDay(allTasks, { date: planDate, workMinutes: workMin })
  const sched  = scheduler(ranked, day, constraints)
  const enriched = enrichSchedule(sched, day, planDate)
  const planText = fmtPlanText(enriched)

  agentLog('planner_plan', { via: 'generate', tasks: ranked.length, blocks: sched.blocks.length, dropped: sched.dropped.length })

  return {
    pendingAction: { type: 'review', planResult: { text: planText, schedule: enriched } },
    sessionContext: {
      lastPlanText: planText, lastSchedule: enriched, activeIntent: 'plan',
      planSchedule: sched, planRanked: ranked,
      planDayStructure: day, planConstraints: constraints,
    },
  }
}

function extractJson(raw) {
  if (!raw) return null
  if (typeof raw !== 'string') return raw
  // Direct parse (Ollama constrained output)
  try { return JSON.parse(raw) } catch {}
  // Strip markdown fences
  const stripped = raw.trim()
    .replace(/^```(?:json)?\r?\n?/im, '')
    .replace(/\r?\n?```\s*$/im, '')
    .trim()
  try { return JSON.parse(stripped) } catch {}
  // Extract first {...} block (Gemma free-form responses)
  const m = stripped.match(/\{[\s\S]*\}/)
  if (m) try { return JSON.parse(m[0]) } catch {}
  return null
}

// ── ADJUST flow ───────────────────────────────────────────────────────────────

async function runAdjust(state, allTasks) {
  const slots = state.plannerSlots || {}
  const ctx   = state.sessionContext || {}
  const feedback    = slots.planFeedback || lastUserMsg(state)
  const prevRanked  = ctx.planRanked      || []
  const prevDay     = ctx.planDayStructure || planAdjust.defaultDayStructure()
  const prevConstr  = ctx.planConstraints  || planAdjust.defaultConstraints()
  const prevSched   = ctx.planSchedule

  // Build task reference for LLM context
  const taskLines = (prevSched?.blocks || [])
    .filter(b => b.kind === 'task' && b.task)
    .map(b => `- id: ${b.task.id}, title: "${b.task.title}"`)
  const taskRef = taskLines.length
    ? `\nCurrently scheduled tasks:\n${taskLines.join('\n')}`
    : ''

  // Flat prompt — classify.js pattern: everything in user message, no system prompt.
  // Gemma 4 ignores systemInstruction on complex prompts; a single merged message works.
  const adjustPrompt = [
    ADJUST_SKILL.trim(),
    taskRef,
    '',
    `User request: "${feedback}"`,
    '',
    'Output a single JSON object only. No markdown, no explanation, no code fences:',
  ].join('\n')

  // LLM call → AdjustPatch, retry once on invalid output
  let patch = null
  for (let attempt = 0; attempt < 2 && !patch; attempt++) {
    try {
      const raw = await generate(adjustPrompt, adjustPatchOllamaSchema, null, { num_predict: 256, maxOutputTokens: 256 })
      const obj = extractJson(raw)
      if (!obj) { agentLog('planner_plan:adjust', { attempt, warn: 'no JSON found in response' }); continue }
      const result = validateAdjustPatch(obj)
      if (result.valid) patch = result.value
      else agentLog('planner_plan:adjust', { attempt, errors: result.errors })
    } catch (e) {
      agentLog('planner_plan:adjust', { attempt, parseError: e.message })
    }
  }

  if (!patch) {
    return { result: { intent: 'plan', response: "I couldn't understand that adjustment. Could you describe the change more specifically?" } }
  }

  if (patch.needsClarification) {
    return { result: { intent: 'plan', response: patch.needsClarification.question } }
  }

  // Apply patch deterministically
  const day2 = planAdjust.applyDayStructurePatch(prevDay, patch.dayStructure)
  const { ranked: ranked2, clarification } = planAdjust.applyTaskDelta(prevRanked, patch, store)
  if (clarification) return { result: { intent: 'plan', response: clarification } }

  const constr2 = planAdjust.mergeConstraints(prevConstr, patch)
  const sched2  = scheduler(ranked2, day2, constr2)
  const planDate = ctx.lastSchedule?.date || (require('../llm.js').getToday())
  const enriched2 = enrichSchedule(sched2, day2, planDate)
  const planText2 = fmtPlanText(enriched2)

  agentLog('planner_plan', { via: 'adjust', levers: Object.keys(patch), blocks: sched2.blocks.length, dropped: sched2.dropped.length })

  return {
    pendingAction: { type: 'review', planResult: { text: planText2, schedule: enriched2 } },
    plannerSlots: { ...(state.plannerSlots || {}), planFeedback: null },
    sessionContext: {
      lastPlanText: planText2, lastSchedule: enriched2, activeIntent: 'plan',
      planSchedule: sched2, planRanked: ranked2,
      planDayStructure: day2, planConstraints: constr2,
    },
  }
}

// ── plannerPlan — entry point ─────────────────────────────────────────────────

export async function plannerPlan(state) {
  const slots = state.plannerSlots || {}
  const ctx   = state.sessionContext || {}
  const allTasks = state.tasks || store.readTasks()

  // Route: ADJUST if we have a prior schedule and ranked list; GENERATE otherwise
  const hasExisting = !!(ctx.planSchedule && ctx.planRanked)
  agentLog('planner_plan', { flow: hasExisting ? 'adjust' : 'generate', tasks: allTasks.length })

  if (hasExisting) return runAdjust(state, allTasks)
  return runGenerate(state, allTasks)
}

export async function plannerPlanReview(state) {
  const { text, schedule } = state.pendingAction.planResult
  agentLog('planner_plan_review', { INTERRUPT: true, blocks: schedule.blocks?.length ?? 0, dropped: schedule.dropped?.length ?? 0 })

  const decision = interrupt({ kind: 'approve', summary: text, schedule, options: ['approve', 'reject'] })
  agentLog('planner_plan_review', { decision: typeof decision === 'string' && decision.length > 30 ? decision.slice(0, 30) + '…' : decision })

  if (decision === 'approve') {
    return {
      result: { intent: 'plan', response: 'Plan approved — your schedule is set for the day.' },
      pendingAction: null,
    }
  }

  if (decision === 'reject') {
    agentLog('planner_plan_review', { action: 'reject → GENERATE from scratch' })
    return {
      pendingAction: null,
      plannerSlots: { ...(state.plannerSlots || {}), subIntent: 'plan', planFeedback: null },
      sessionContext: {
        lastPlanText: null, lastSchedule: null, activeIntent: 'plan',
        planSchedule: null, planRanked: null, planDayStructure: null, planConstraints: null,
      },
    }
  }

  // Any other text → ADJUST feedback; keep planSchedule/planRanked for ADJUST routing
  agentLog('planner_plan_review', { action: 'feedback → ADJUST' })
  return {
    pendingAction: null,
    plannerSlots: { ...(state.plannerSlots || {}), subIntent: 'plan', planFeedback: decision },
    sessionContext: { lastPlanText: text, lastSchedule: schedule, activeIntent: 'plan' },
  }
}

export async function reorderConfirm(state) {
  const slots = state.plannerSlots
  agentLog('reorder_confirm', { INTERRUPT: true, id: slots.id, to: slots.to, refId: slots.refId })
  const summary = `Move task [${slots.id}] to ${slots.to}${slots.refId ? ' ' + slots.refId : ''}?`
  const decision = interrupt({ kind: 'approve', summary, options: ['approve', 'reject'] })
  agentLog('reorder_confirm', { decision })
  if (decision !== 'approve') {
    return { result: { intent: 'reorder', response: "Okay, move cancelled." }, pendingAction: null }
  }
  const tasks = store.reorderTask(slots.id, slots.to, slots.refId)
  const response = tasks
    ? `Moved [${slots.id}] to ${slots.to}${slots.refId ? ' ' + slots.refId : ''}.`
    : `Task "${slots.id}" not found.`
  return { result: { intent: 'reorder', response }, pendingAction: null }
}

function blockMinutes(block) {
  const [sh, sm] = block.start.split(':').map(Number)
  const [eh, em] = block.end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

export async function plannerComplete(state) {
  const schedule = state.sessionContext?.lastSchedule
  if (!schedule?.blocks?.length) {
    return { result: { intent: 'plan', response: "No active plan found to mark as complete." } }
  }

  const taskTime = new Map()
  for (const block of schedule.blocks) {
    if (block.type !== 'task' || !block.task) continue
    const id = block.task.id
    const dur = blockMinutes(block)
    if (taskTime.has(id)) {
      const e = taskTime.get(id)
      e.totalMin += dur
      e.finalPartial = block.partial
    } else {
      taskTime.set(id, { blockTask: block.task, totalMin: dur, finalPartial: block.partial })
    }
  }

  const allTasks = store.readTasks()
  const byTitle = new Map(allTasks.map(t => [t.title.toLowerCase(), t]))

  const updates = []
  for (const [id, { blockTask, totalMin, finalPartial }] of taskTime) {
    const current = store.readTasks(id)[0]
      ?? byTitle.get((blockTask.title || '').toLowerCase())
    if (!current) continue

    const hoursSpent = totalMin / 60

    if (!finalPartial) {
      updates.push({
        id: current.id,
        title: current.title,
        changes: { status: 'done', logged_hours: current.estimate_hours ?? (current.logged_hours ?? 0) + hoursSpent },
        label: 'done',
      })
    } else {
      const newLogged = parseFloat(((current.logged_hours ?? 0) + hoursSpent).toFixed(2))
      updates.push({
        id: current.id,
        title: current.title,
        changes: { status: 'in_progress', logged_hours: newLogged },
        label: 'in_progress',
        remaining: current.estimate_hours != null
          ? Math.max(0, current.estimate_hours - newLogged)
          : null,
      })
    }
  }

  if (!updates.length) {
    return { result: { intent: 'plan', response: "No matching tasks found to update." } }
  }

  const lines = updates.map(u => {
    if (u.label === 'done') return `✓ ${u.title} → done`
    const rem = u.remaining != null ? ` (${u.remaining.toFixed(1)}h remaining)` : ''
    return `↻ ${u.title} → in_progress${rem}`
  })
  const summary = `Mark plan complete for ${schedule.date}:\n${lines.join('\n')}`

  agentLog('planner_complete', { INTERRUPT: true, updates: updates.length, date: schedule.date })
  const decision = interrupt({ kind: 'approve', summary, options: ['approve', 'reject'] })
  agentLog('planner_complete', { decision })

  if (decision !== 'approve') {
    return { result: { intent: 'plan', response: "No changes made." } }
  }

  for (const u of updates) {
    store.updateTask(u.id, u.changes)
  }

  const doneCount = updates.filter(u => u.label === 'done').length
  const progressCount = updates.filter(u => u.label === 'in_progress').length
  const parts = []
  if (doneCount) parts.push(`${doneCount} task${doneCount > 1 ? 's' : ''} marked done`)
  if (progressCount) parts.push(`${progressCount} updated to in_progress`)

  agentLog('planner_complete', { applied: updates.length, done: doneCount, inProgress: progressCount })
  return {
    result: { intent: 'plan', response: `Plan complete! ${parts.join(', ')}.` },
    sessionContext: { lastPlanText: null, lastSchedule: null },
  }
}
