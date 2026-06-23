import { Annotation } from '@langchain/langgraph'

const mergeContext = (a, b) => b ? { ...(a || {}), ...b } : a

export const AgentState = Annotation.Root({
  messages: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  route: Annotation(),
  todoSlots: Annotation(),
  plannerSlots: Annotation(),
  ragSlots: Annotation(),
  tasks: Annotation(),
  pendingAction: Annotation(),
  result: Annotation(),
  sessionContext: Annotation({ reducer: mergeContext, default: () => null }),
})

// Flip any entry to true to gate that node behind a human review.
export const HITL = {
  router: false,
  todo_understand: false,
  todo_execute: false,
  todo_confirm: true,
  todo_clarify: true,
  reorder_confirm: true,
  planner_plan_review: true,
  planner_rank: false,
  planner_plan: false,
  planner_understand: false,
  planner_complete: true,
  router_clarify: true,
}
