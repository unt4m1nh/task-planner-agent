import { END } from '@langchain/langgraph'
import { CONFIG } from '../guardrails.mjs'

export function afterRouter(state) {
  if (state.route === 'todo') return 'todo_understand'
  if (state.route === 'planner') return 'planner_understand'
  if (state.route === 'rag') return 'rag_retrieve'
  return 'router_clarify'
}

export function afterTodoUnderstand(state) {
  const pa = state.pendingAction
  if (!pa) return 'todo_execute'
  if (pa.type === 'clarify') return 'todo_clarify'
  if (pa.type === 'confirm') return 'todo_confirm'
  return 'todo_execute'
}

export function afterTodoConfirm(state) {
  return state.result ? END : 'todo_execute'
}

export function afterPlannerUnderstand(state) {
  const sub = state.plannerSlots?.subIntent
  if (sub === 'rank') return 'planner_rank'
  if (sub === 'reorder') return 'reorder_confirm'
  if (sub === 'complete') return 'planner_complete'
  return 'planner_plan'
}

export function afterPlannerPlan(state) {
  // Early exit (clarification / parse failure) → END; otherwise always show review
  return state.result ? END : 'planner_plan_review'
}

export function afterPlannerPlanReview(state) {
  return state.result ? END : 'planner_plan'
}

export function afterRagGrade(state) {
  const { relevant, attempts = 0 } = state.ragSlots
  if (relevant || attempts >= CONFIG.steps.MAX_ITERATIONS) return 'rag_generate'
  return 'rag_rewrite'
}
