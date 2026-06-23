// Agentic RAG loop steps — ports the LangGraph agentic-RAG tutorial
// (generate_query_or_respond → retrieve → grade_documents → generate_answer |
// rewrite_question → loop) onto this project's small-model, schema-enforced
// LLM pattern. See agent/graph/nodes-rag.mjs for the StateGraph wiring.

const { generate, buildTaskContext } = require('../llm')
const { gradeDocumentsSchema, rewriteQuestionSchema } = require('../agent/classify/schema')
const { searchDocuments } = require('./search')

const MAX_REWRITES = 2

async function retrieveStep(query, { topK = 5, source } = {}) {
  return searchDocuments(query, { topK, source })
}

function extractJSON(raw) {
  if (!raw) return null
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try { return JSON.parse(s.slice(start, end + 1)) } catch { return null }
}

async function gradeStep(query, docs) {
  if (!docs.length) return false
  const context = docs.map((d, i) => `[${i + 1}] ${d.text}`).join('\n\n')
  const prompt = [
    'You grade whether retrieved documents are relevant to a user question.',
    '',
    `Question: "${query}"`,
    '',
    'Retrieved documents:',
    context,
    '',
    'Output a single JSON object only. No markdown, no explanation, no code fences:',
  ].join('\n')

  try {
    const raw = await generate(prompt, gradeDocumentsSchema, null, { num_predict: 16, maxOutputTokens: 16 })
    const parsed = extractJSON(raw)
    return parsed?.binary_score === 'yes'
  } catch (e) {
    console.error('[rag:grade] LLM call failed, treating as relevant:', e.message)
    return true
  }
}

async function rewriteStep(query) {
  const prompt = [
    'Reformulate this question to improve semantic search retrieval.',
    'Keep the underlying intent — make it more specific and keyword-rich.',
    '',
    `Original question: "${query}"`,
    '',
    'Output a single JSON object only. No markdown, no explanation, no code fences:',
  ].join('\n')

  try {
    const raw = await generate(prompt, rewriteQuestionSchema, null, { num_predict: 64, maxOutputTokens: 64 })
    const parsed = extractJSON(raw)
    return parsed?.rewrittenQuery?.trim() || query
  } catch (e) {
    console.error('[rag:rewrite] LLM call failed, keeping original query:', e.message)
    return query
  }
}

async function generateStep(originalQuery, docs, { includeTaskContext = true } = {}) {
  if (!docs.length) {
    return {
      answer: "I couldn't find anything relevant in your uploaded documents or daily-planner logs.",
      sources: [],
    }
  }

  const context = docs.map((d, i) => `[${i + 1}] (${d.source}: "${d.title}")\n${d.text}`).join('\n\n')
  const lines = [
    'Answer the question using ONLY the context below. Cite sources by their [n] tag.',
    "If the context doesn't fully answer the question, say what's missing.",
    '',
    '=== CONTEXT ===',
    context,
    '=== END CONTEXT ===',
  ]
  if (includeTaskContext) {
    lines.push('', '=== CURRENT TASKS ===', buildTaskContext(), '=== END CURRENT TASKS ===')
  }
  lines.push('', `Question: "${originalQuery}"`, '', 'Answer:')

  const answer = await generate(lines.join('\n'), null, null, { num_predict: 400, maxOutputTokens: 400 })
  return {
    answer: answer.trim(),
    sources: docs.map(d => ({ title: d.title, source: d.source, documentId: d.documentId })),
  }
}

// Full retrieve → grade → (generate | rewrite → loop) flow as one callable
// function. Any node (rag branch, planner, todo) can call this directly to
// get a grounded answer without needing to be wired into the rag StateGraph.
async function runAgenticRag(question, opts = {}) {
  let query = question
  let docs = []
  for (let attempt = 0; attempt <= MAX_REWRITES; attempt++) {
    docs = await retrieveStep(query, opts)
    const relevant = await gradeStep(query, docs)
    if (relevant || attempt === MAX_REWRITES) break
    query = await rewriteStep(query)
  }
  const { answer, sources } = await generateStep(question, docs, opts)
  return { answer, sources, finalQuery: query, rewrites: query !== question }
}

module.exports = { retrieveStep, gradeStep, rewriteStep, generateStep, runAgenticRag, MAX_REWRITES }
