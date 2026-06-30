// ─── per-intent schemas ──────────────────────────────────────────────────────

const listSchema = {
  type: 'object',
  required: ['intent'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'list' },
    status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'scheduled'] },
    priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'] },
    source: { type: 'string', enum: ['jira', 'notion', 'google_calendar', 'manual', 'wire'] },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    query: {
      type: 'string',
      description: 'Free-text keyword search against title and description',
    },
  },
}

const readSchema = {
  type: 'object',
  required: ['intent', 'id'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'read' },
    id: { type: 'string', description: 'Id of the single task to look up' },
  },
}

const addSchema = {
  type: 'object',
  required: ['intent', 'title'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'add' },
    title: { type: 'string' },
    description: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'scheduled'] },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    due: {
      type: 'string',
      description: 'ISO 8601 date string, e.g. "2026-06-30"',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    },
    source: {
      type: 'string',
      enum: ['jira', 'notion', 'google_calendar', 'manual', 'wire'],
      default: 'manual',
    },
  },
}

const editSchema = {
  type: 'object',
  required: ['intent', 'id'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'edit' },
    id: { type: 'string', description: 'Target task id' },
    fields: {
      type: 'object',
      description: 'Direct field replacements, e.g. { "status": "done" }',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'] },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'scheduled'] },
        due_date: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        },
        tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        estimate_hours: { type: 'number', minimum: 0 },
      },
    },
    append: {
      type: 'object',
      description: 'Add to an existing field instead of replacing it — a tag, a subtask, or extra title text',
      additionalProperties: false,
      properties: {
        field: {
          type: 'string',
          enum: ['tags', 'subtasks', 'title'],
        },
        value: { type: 'string' },
      },
    },
  },
}

const reorderSchema = {
  type: 'object',
  required: ['intent', 'id', 'to'],
  additionalProperties: false,
  if: {
    properties: { to: { enum: ['before', 'after'] } },
    required: ['to'],
  },
  then: { required: ['intent', 'id', 'to', 'refId'] },
  properties: {
    intent: { type: 'string', const: 'reorder' },
    id: { type: 'string', description: 'Id of the task to move' },
    to: {
      type: 'string',
      enum: ['top', 'bottom', 'before', 'after'],
      description: '"top" and "bottom" need no refId; "before"/"after" require refId',
    },
    refId: {
      type: 'string',
      description: 'Id of the anchor task — required when to is "before" or "after"',
    },
  },
}

const suggestSchema = {
  type: 'object',
  required: ['intent'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'suggest' },
    availableMinutes: {
      type: 'integer',
      minimum: 1,
      description: 'How many minutes the user has available right now',
    },
    mood: {
      type: 'string',
      enum: ['tired', 'energetic', 'neutral'],
      description: 'Energy level of the user',
    },
    preference: {
      type: 'string',
      enum: ['quick', 'important', 'due_soon'],
      description: 'Working preference expressed by the user',
    },
  },
}

const planSchema = {
  type: 'object',
  required: ['intent'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'plan' },
    date: {
      type: 'string',
      description: 'Day to plan, ISO date e.g. "2026-06-10" — omit for today',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    },
    startTime: { type: 'string', description: 'Work window start, "HH:MM"', pattern: '^\\d{2}:\\d{2}$' },
    endTime: { type: 'string', description: 'Work window end, "HH:MM"', pattern: '^\\d{2}:\\d{2}$' },
    availableMinutes: {
      type: 'integer',
      minimum: 1,
      description: 'Total minutes available, when no end time is given',
    },
  },
}

const unknownSchema = {
  type: 'object',
  required: ['intent'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'unknown' },
    clarification: {
      type: 'string',
      description: 'Ask the user what they meant',
    },
  },
}

const askSchema = {
  type: 'object',
  required: ['intent', 'query'],
  additionalProperties: false,
  properties: {
    intent: { type: 'string', const: 'ask' },
    query: {
      type: 'string',
      description: 'The question to answer, grounded in uploaded docs and daily-planner logs',
    },
  },
}

// ─── combined schema (oneOf discriminated by intent) ─────────────────────────

const intentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TaskAgentIntent',
  description: 'One classified intent with its extracted slots',
  oneOf: [
    listSchema,
    readSchema,
    addSchema,
    editSchema,
    reorderSchema,
    suggestSchema,
    planSchema,
    unknownSchema,
    askSchema,
  ],
}

// ─── flat schema for Ollama constrained decoding ─────────────────────────────
// oneOf is unreliable with small models under constrained decoding.
// This flat version keeps all fields optional except `intent` so the
// model always produces valid JSON while still being guided by the prompt.

const ollamaSchema = {
  type: 'object',
  required: ['intent'],
  properties: {
    intent: { type: 'string', enum: ['list', 'read', 'add', 'edit', 'delete', 'reorder', 'suggest', 'plan', 'ask', 'unknown'] },
    continuation: {
      type: 'boolean',
      description: 'true if this message is a follow-up to the recent conversation (e.g. "what about the high-priority ones?") rather than a standalone request',
    },
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    due: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'] },
    status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'scheduled'] },
    source: { type: 'string', enum: ['jira', 'notion', 'google_calendar', 'manual', 'wire'] },
    tags: { type: 'array', items: { type: 'string' } },
    query: { type: 'string' },
    fields: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        due_date: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low', 'critical'] },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done', 'scheduled'] },
        tags: { type: 'array', items: { type: 'string' } },
        estimate_hours: { type: 'number' },
      },
    },
    append: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: ['tags', 'subtasks', 'title'] },
        value: { type: 'string' },
      },
    },
    to: { type: 'string', enum: ['top', 'bottom', 'before', 'after'] },
    refId: { type: 'string' },
    availableMinutes: { type: 'integer' },
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    mood: { type: 'string', enum: ['tired', 'energetic', 'neutral'] },
    preference: { type: 'string', enum: ['quick', 'important', 'due_soon'] },
    clarification: { type: 'string' },
  },
}

// ─── Agentic RAG loop schemas (grade_documents / rewrite_question) ──────────
// Mirrors the LangGraph agentic-RAG tutorial's structured-output steps —
// see agent/rag/agentic.js for the retrieve→grade→(generate|rewrite) loop.

const gradeDocumentsSchema = {
  type: 'object',
  required: ['binary_score'],
  additionalProperties: false,
  properties: {
    binary_score: {
      type: 'string',
      enum: ['yes', 'no'],
      description: '"yes" if the retrieved documents are relevant to the question, else "no"',
    },
  },
}

const rewriteQuestionSchema = {
  type: 'object',
  required: ['rewrittenQuery'],
  additionalProperties: false,
  properties: {
    rewrittenQuery: {
      type: 'string',
      description: 'The original question reformulated to improve semantic retrieval',
    },
  },
}

const generateAnswerSchema = {
  type: 'object',
  required: ['reasoning', 'answer'],
  additionalProperties: false,
  properties: {
    reasoning: {
      type: 'string',
      description: 'Internal analysis: does the retrieved context actually support an answer, what is missing, contradictory, or low-confidence — written before the final answer',
    },
    answer: {
      type: 'object',
      required: ['question', 'dataRetrieved'],
      additionalProperties: false,
      properties: {
        question: {
          type: 'string',
          description: 'Paraphrase of the user question (rewording accepted, no need to quote verbatim)',
        },
        dataRetrieved: {
          type: 'string',
          description: 'The direct answer to the question, in prose — not a data dump. Cite sources by [n], and be critical: call out gaps, contradictions, or low confidence in the retrieved data rather than restating it at face value. This is the only field shown to the user, so it must stand alone as a complete answer.',
        },
      },
    },
  },
}

// ─── AdjustPatch schema (flat, for small-model constrained decoding) ─────────
// Nested swap/dayStructure objects are flattened for Ollama reliability.
// validateAdjustPatch() reshapes the flat output into the canonical AdjustPatch.

const adjustPatchOllamaSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    setMaxSession: {
      type: 'integer',
      minimum: 15,
      description: 'Max session length in minutes (e.g. 120 for "2 hours"); omit to keep current',
    },
    break: { type: 'string', enum: ['more', 'less', 'off'] },
    swapRemoveId: { type: 'string', description: 'Exact task id to remove from the schedule' },
    swapCriteria: { type: 'string', enum: ['quick', 'important', 'due_soon'] },
    pin: { type: 'array', items: { type: 'string' }, description: 'Task ids to force-keep' },
    exclude: { type: 'array', items: { type: 'string' }, description: 'Task ids to force-drop' },
    setWorkStart: { type: 'string', description: 'New work-window start time HH:MM' },
    setWorkEnd: { type: 'string', description: 'New work-window end time HH:MM' },
    needsClarification: { type: 'string', description: 'Question to ask when the request is ambiguous' },
  },
}

const HH_MM_RE = /^\d{2}:\d{2}$/

function validateAdjustPatch(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['not an object'], value: null }
  }

  const patch = {}
  const errors = []

  if (obj.needsClarification != null) {
    patch.needsClarification = { question: String(obj.needsClarification) }
    return { valid: true, errors: [], value: patch }
  }

  if ('setMaxSession' in obj) {
    if (obj.setMaxSession === null || obj.setMaxSession === 0) {
      patch.setMaxSession = null
    } else if (typeof obj.setMaxSession === 'number' && obj.setMaxSession >= 15) {
      patch.setMaxSession = Math.round(obj.setMaxSession)
    } else {
      errors.push('setMaxSession must be a positive integer (minutes) or null')
    }
  }

  if (obj.break != null) {
    if (!['more', 'less', 'off'].includes(obj.break)) errors.push('break must be "more", "less", or "off"')
    else patch.break = obj.break
  }

  if (obj.swapRemoveId) {
    patch.swap = { removeId: String(obj.swapRemoveId) }
    if (obj.swapCriteria != null) {
      if (!['quick', 'important', 'due_soon'].includes(obj.swapCriteria)) {
        errors.push('swapCriteria must be quick/important/due_soon')
      } else {
        patch.swap.criteria = obj.swapCriteria
      }
    }
  }

  if (obj.pin) {
    if (!Array.isArray(obj.pin)) errors.push('pin must be an array')
    else patch.pin = obj.pin.filter(x => typeof x === 'string')
  }

  if (obj.exclude) {
    if (!Array.isArray(obj.exclude)) errors.push('exclude must be an array')
    else patch.exclude = obj.exclude.filter(x => typeof x === 'string')
  }

  if (obj.setWorkStart || obj.setWorkEnd) {
    const dsWin = { index: 0 }
    if (obj.setWorkStart) {
      if (!HH_MM_RE.test(obj.setWorkStart)) errors.push('setWorkStart must be HH:MM')
      else dsWin.start = obj.setWorkStart
    }
    if (obj.setWorkEnd) {
      if (!HH_MM_RE.test(obj.setWorkEnd)) errors.push('setWorkEnd must be HH:MM')
      else dsWin.end = obj.setWorkEnd
    }
    if (!errors.length) patch.dayStructure = { setWorkWindow: dsWin }
  }

  const hasLever = Object.keys(patch).length > 0
  if (!hasLever && !errors.length) errors.push('no recognized levers in patch')

  return { valid: errors.length === 0, errors, value: errors.length === 0 ? patch : null }
}

module.exports = {
  intentSchema,
  ollamaSchema,
  adjustPatchOllamaSchema,
  validateAdjustPatch,
  listSchema,
  readSchema,
  addSchema,
  editSchema,
  reorderSchema,
  suggestSchema,
  planSchema,
  unknownSchema,
  generateAnswerSchema,
  askSchema,
  gradeDocumentsSchema,
  rewriteQuestionSchema,
}
