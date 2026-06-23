import { createRequire } from 'module'
import { interrupt } from '@langchain/langgraph'
import { lastUserMsg, agentLog } from './utils.mjs'

const require = createRequire(import.meta.url)
const { classify } = require('../classify/classify.js')

const TODO_INTENTS = new Set(['list', 'read', 'add', 'edit', 'delete'])
const PLANNER_INTENTS = new Set(['suggest', 'plan', 'reorder'])
const RAG_INTENTS = new Set(['ask'])

// Words that strongly signal the user is talking about their schedule, not a task.
// Used to intercept misclassified "add"/"edit"/"delete" when an active plan exists.
const SCHEDULE_FEEDBACK_RE = /\b(break|lunch\s*break|session|time\s*block|slot|afternoon|morning|evening|schedule|earlier|later|shift|fewer\s*tasks?|more\s*breaks?|shorter|longer)\b/i

function looksLikePlanFeedback(msg, slots) {
  if (SCHEDULE_FEEDBACK_RE.test(msg)) return true
  if (slots.title && SCHEDULE_FEEDBACK_RE.test(slots.title)) return true
  return false
}

export async function routerNode(state) {
  const ctx = state.sessionContext || {}
  const turnCount = (ctx.turnCount ?? 0) + 1

  if (state.plannerSlots && !state.route) {
    agentLog('router', { route: 'planner', via: 'fast-path', intent: state.plannerSlots.intent, turn: turnCount })
    return {
      route: 'planner',
      result: null,
      pendingAction: null,
      sessionContext: { activeRoute: 'planner', activeIntent: state.plannerSlots.intent, turnCount },
    }
  }

  const msg = lastUserMsg(state)
  const classified = await classify(msg)

  if (TODO_INTENTS.has(classified.intent)) {
    // If the user has an active plan and the message reads as schedule feedback
    // (e.g. "add a break in the afternoon"), redirect to planner instead of
    // creating/editing a task.
    if (ctx.lastPlanText && looksLikePlanFeedback(msg, classified)) {
      agentLog('router', { route: 'planner', via: 'plan-feedback-override', classifiedAs: classified.intent, turn: turnCount, msg })
      return {
        route: 'planner',
        plannerSlots: { intent: 'plan', contextFallback: true },
        todoSlots: null,
        result: null,
        pendingAction: null,
        sessionContext: { activeRoute: 'planner', activeIntent: 'plan', turnCount },
      }
    }

    agentLog('router', { route: 'todo', intent: classified.intent, turn: turnCount, msg })
    return {
      route: 'todo',
      todoSlots: classified,
      plannerSlots: null,
      result: null,
      pendingAction: null,
      sessionContext: { activeRoute: 'todo', activeIntent: classified.intent, turnCount },
    }
  }
  if (PLANNER_INTENTS.has(classified.intent)) {
    agentLog('router', { route: 'planner', intent: classified.intent, turn: turnCount, msg })
    return {
      route: 'planner',
      plannerSlots: classified,
      todoSlots: null,
      ragSlots: null,
      result: null,
      pendingAction: null,
      sessionContext: { activeRoute: 'planner', activeIntent: classified.intent, turnCount },
    }
  }
  if (RAG_INTENTS.has(classified.intent)) {
    agentLog('router', { route: 'rag', intent: classified.intent, turn: turnCount, msg })
    return {
      route: 'rag',
      ragSlots: { query: classified.query, originalQuery: classified.query, attempts: 0 },
      todoSlots: null,
      plannerSlots: null,
      result: null,
      pendingAction: null,
      sessionContext: { activeRoute: 'rag', activeIntent: classified.intent, turnCount },
    }
  }

  if (ctx.activeRoute && ctx.activeIntent) {
    agentLog('router', { route: ctx.activeRoute, via: 'context-fallback', activeIntent: ctx.activeIntent, turn: turnCount, msg })
    if (ctx.activeRoute === 'todo') {
      return {
        route: 'todo',
        todoSlots: { intent: ctx.activeIntent, contextFallback: true },
        plannerSlots: null,
        ragSlots: null,
        result: null,
        pendingAction: null,
        sessionContext: { turnCount },
      }
    }
    if (ctx.activeRoute === 'planner') {
      return {
        route: 'planner',
        plannerSlots: { intent: ctx.activeIntent, contextFallback: true },
        todoSlots: null,
        ragSlots: null,
        result: null,
        pendingAction: null,
        sessionContext: { turnCount },
      }
    }
    if (ctx.activeRoute === 'rag') {
      return {
        route: 'rag',
        ragSlots: { query: msg, originalQuery: msg, attempts: 0 },
        todoSlots: null,
        plannerSlots: null,
        result: null,
        pendingAction: null,
        sessionContext: { turnCount },
      }
    }
  }

  agentLog('router', { route: 'unknown', intent: classified.intent, turn: turnCount, msg })
  return {
    route: 'unknown',
    todoSlots: null,
    plannerSlots: null,
    ragSlots: null,
    result: null,
    pendingAction: null,
    sessionContext: { turnCount },
  }
}

export async function routerClarify(state) {
  agentLog('router_clarify', { INTERRUPT: true, kind: 'clarify' })
  const answer = interrupt({
    kind: 'clarify',
    question: "I'm not sure what you'd like to do. Could you rephrase?",
  })
  return {
    messages: [{ role: 'user', content: answer }],
    route: null,
    todoSlots: null,
    plannerSlots: null,
  }
}
