import { fileURLToPath } from 'url'
import path from 'path'
import { StateGraph, START, END } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

import { AgentState } from './state.mjs'
import { routerNode, routerClarify } from './nodes-router.mjs'
import { todoUnderstand, todoClarify, todoConfirm, todoExecute } from './nodes-todo.mjs'
import { plannerUnderstand, plannerRank, plannerPlan, plannerPlanReview, plannerComplete, reorderConfirm } from './nodes-planner.mjs'
import { afterRouter, afterTodoUnderstand, afterTodoConfirm, afterPlannerUnderstand, afterPlannerPlan, afterPlannerPlanReview } from './edges.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const graph = new StateGraph(AgentState)

graph
  .addNode('router', routerNode)
  .addNode('router_clarify', routerClarify)
  .addNode('todo_understand', todoUnderstand)
  .addNode('todo_clarify', todoClarify)
  .addNode('todo_confirm', todoConfirm)
  .addNode('todo_execute', todoExecute)
  .addNode('planner_understand', plannerUnderstand)
  .addNode('planner_rank', plannerRank)
  .addNode('planner_complete', plannerComplete)
  .addNode('planner_plan', plannerPlan)
  .addNode('planner_plan_review', plannerPlanReview)
  .addNode('reorder_confirm', reorderConfirm)

graph
  .addEdge(START, 'router')
  .addConditionalEdges('router', afterRouter, ['todo_understand', 'planner_understand', 'router_clarify'])
  .addEdge('router_clarify', 'router')
  .addConditionalEdges('todo_understand', afterTodoUnderstand, ['todo_clarify', 'todo_confirm', 'todo_execute'])
  .addEdge('todo_clarify', 'todo_understand')
  .addConditionalEdges('todo_confirm', afterTodoConfirm, ['todo_execute', END])
  .addEdge('todo_execute', END)
  .addConditionalEdges('planner_understand', afterPlannerUnderstand, ['planner_rank', 'planner_plan', 'reorder_confirm', 'planner_complete'])
  .addEdge('planner_rank', END)
  .addConditionalEdges('planner_plan', afterPlannerPlan, ['planner_plan_review', END])
  .addConditionalEdges('planner_plan_review', afterPlannerPlanReview, ['planner_plan', END])
  .addEdge('reorder_confirm', END)
  .addEdge('planner_complete', END)

const DB_PATH = path.resolve(__dirname, '../../../../checkpoints.db')
const checkpointer = SqliteSaver.fromConnString(DB_PATH)

export const app = graph.compile({ checkpointer })
