import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import path from 'path'
import { interrupt } from '@langchain/langgraph'
import { lastUserMsg, agentLog, parsePlanText, fmtPlanText } from './utils.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const { generate } = require('../llm.js')
const store = require('../store.js')
const { suggestTasks } = require('./suggest.js')
const { planDay } = require('./planner.js')

const PLAN_SKILL = readFileSync(
  path.resolve(__dirname, './plan-day/SKILL.md'), 'utf8'
).replace(/^---[\s\S]*?---\n/, '')

const PLAN_MODIFY_SKILL = `You are editing an existing daily schedule based on user feedback.

Your job: make ONLY the specific changes the user requests. Do not replan from scratch.

Scheduling rules to maintain:
- Default window: 08:30–17:30
- Lunch break 12:00–13:00 is FIXED and INDEPENDENT — never move, remove, or merge it with adjacent break sessions
- No short break may end at 12:00 (right before lunch) or start at 13:00 (right after lunch)
- Minimum work block: 30 minutes (meetings may be shorter, ≥ 15 min)
- Break duration: 15 minutes
- Block sizes must be multiples of 30 minutes (30, 60, 90, 120 …)
- Leftover time < 30 minutes → absorbed into break buffer, not a work block
- After editing, re-check that all end times are correct (end = start + duration) and no block overlaps lunch

Common edits:
- "fewer tasks" → remove the lowest-priority (low priority, no due date) task blocks; list them under ⚠️ Didn't fit; close the gap by shifting later blocks earlier
- "more breaks" / "more break-time" → insert 15-minute break blocks between task blocks; shorten the last task block to make room if needed
- "longer breaks" → extend existing break blocks by 15-minute increments; shorten adjacent task blocks to fit
- "shorter tasks" / "less time on X" → reduce a task block to the nearest 30-min multiple below; mark it partial with (~Xm remaining) if it had more time
- "move X earlier/later" → shift that task's time slot; ripple-shift subsequent blocks to avoid overlap
- "remove X" → drop that task, shift later blocks earlier, add a break if extra time allows

Output rules:
- Output ONLY the schedule. No explanation, no preamble, no markdown fences.
- The very first line MUST be exactly: Plan for YYYY-MM-DD (HH:MM–HH:MM):
- Task rows: HH:MM–HH:MM  Task title (priority)
- Break rows: HH:MM–HH:MM  break
- Partial rows: HH:MM–HH:MM  Task title (priority) — partial (~Xm remaining)
- Times must be HH:MM zero-padded; end times must not exceed the window end
- If tasks are removed or dropped, append after a blank line: ⚠️ Didn't fit: Task A, Task B`

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

  const hasPriorPlan = !!ctx.lastPlanText
  const hasPriorSchedule = !!ctx.lastSchedule

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
  agentLog('planner_understand', { subIntent, tasks: allTasks.length, followUp: isFollowUp, modification: isPlanModification })
  return {
    tasks: allTasks,
    plannerSlots: {
      ...slots,
      subIntent,
      ...(planFeedback ? { planFeedback } : {}),
      ...(ctx.lastPlanText && isFollowUp ? { lastPlanText: ctx.lastPlanText } : {}),
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

export async function plannerPlan(state) {
  const slots = state.plannerSlots || {}
  const allTasks = state.tasks || store.readTasks()
  const isModification = !!(slots.planFeedback && slots.lastPlanText)
  agentLog('planner_plan', { date: slots.date, startTime: slots.startTime, endTime: slots.endTime, tasks: allTasks.length, modification: isModification })

  let planText, schedule

  if (isModification) {
    const prompt = [
      `Current plan:`,
      slots.lastPlanText,
      ``,
      `User request: "${slots.planFeedback}"`,
      ``,
      `Apply the change. Output only the updated schedule.`,
    ].join('\n')

    agentLog('planner_plan', { via: 'llm-modify', feedback: slots.planFeedback })
    const raw = await generate(prompt, null, PLAN_MODIFY_SKILL, { num_predict: 1024, maxOutputTokens: 1024 })
    const rawClean = raw ? raw.trim().replace(/^```[a-z]*\r?\n?/im, '').replace(/\r?\n?```\s*$/im, '').trim() : ''
    schedule = parsePlanText(rawClean, allTasks)

    if (schedule) {
      planText = rawClean
    } else {
      console.warn('[planner_plan] parsePlanText failed. Full LLM output:\n', rawClean)
      agentLog('planner_plan', { warn: 'parsePlanText failed, falling back to algo' })
    }
  }

  if (!schedule) {
    const plan = planDay(allTasks, {
      date: slots.date,
      startTime: slots.startTime,
      endTime: slots.endTime,
      availableMinutes: slots.availableMinutes,
    })
    planText = fmtPlanText(plan)
    schedule = plan
  }

  agentLog('planner_plan:result', { blocks: schedule.blocks?.length ?? 0, unplaced: schedule.unplaced?.length ?? 0 })

  // Always queue a review — plannerPlanReview handles approve / feedback loop
  return {
    pendingAction: { type: 'review', planResult: { text: planText, schedule } },
    sessionContext: { lastPlanText: planText, lastSchedule: schedule, activeIntent: 'plan' },
  }
}

export async function plannerPlanReview(state) {
  const { text, schedule } = state.pendingAction.planResult
  agentLog('planner_plan_review', { INTERRUPT: true, blocks: schedule.blocks?.length ?? 0, unplaced: schedule.unplaced?.length ?? 0 })

  const decision = interrupt({ kind: 'approve', summary: text, schedule, options: ['approve', 'reject'] })
  agentLog('planner_plan_review', { decision })

  if (decision === 'approve') {
    return {
      result: { intent: 'plan', response: 'Plan approved — your schedule is set for the day.' },
      pendingAction: null,
    }
  }

  if (decision === 'reject') {
    // Discard current plan and re-run the algo from scratch
    agentLog('planner_plan_review', { action: 'reject → replanning from scratch' })
    return {
      pendingAction: null,
      plannerSlots: { ...(state.plannerSlots || {}), subIntent: 'plan', planFeedback: null, lastPlanText: null },
      sessionContext: { lastPlanText: null, lastSchedule: null, activeIntent: 'plan' },
    }
  }

  // Any other text is treated as modification feedback — loop back to plannerPlan
  agentLog('planner_plan_review', { action: 'feedback', feedback: decision })
  return {
    pendingAction: null,
    plannerSlots: { ...(state.plannerSlots || {}), subIntent: 'plan', planFeedback: decision, lastPlanText: text },
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
