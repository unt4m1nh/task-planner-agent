import { createRequire } from 'module'
import { agentLog } from './utils.mjs'

const require = createRequire(import.meta.url)
const { retrieveStep, gradeStep, rewriteStep, generateStep } = require('../../rag/agentic.js')

// Mirrors the LangGraph agentic-RAG tutorial's graph topology:
//   rag_retrieve → rag_grade → (rag_generate | rag_rewrite → rag_retrieve, capped)
// Each step is its own node so the loop is visible in LangGraph Studio traces,
// and so other branches (planner/todo) can still call the underlying pure
// steps in agentic.js directly without going through this subgraph.

export async function ragRetrieve(state) {
  const { query } = state.ragSlots
  const docs = await retrieveStep(query)
  agentLog('rag_retrieve', { query, hits: docs.length })
  return { ragSlots: { ...state.ragSlots, docs } }
}

export async function ragGrade(state) {
  const { query, docs, attempts = 0 } = state.ragSlots
  const relevant = await gradeStep(query, docs)
  agentLog('rag_grade', { query, relevant, attempts })
  return { ragSlots: { ...state.ragSlots, relevant, attempts } }
}

export async function ragRewrite(state) {
  const { query, attempts = 0 } = state.ragSlots
  const rewrittenQuery = await rewriteStep(query)
  agentLog('rag_rewrite', { from: query, to: rewrittenQuery, attempts: attempts + 1 })
  return { ragSlots: { ...state.ragSlots, query: rewrittenQuery, attempts: attempts + 1 } }
}

export async function ragGenerate(state) {
  const { originalQuery, docs } = state.ragSlots
  const { answer, reasoning, sources } = await generateStep(originalQuery, docs || [])
  agentLog('rag_generate', { sources: sources.length, reasoning })
  return {
    result: { intent: 'ask', response: answer, sources },
    ragSlots: null,
  }
}
