// ─── per-intent schemas ───────────────────────────────────────────────────────

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
    intent: { type: 'string', enum: ['list', 'read', 'add', 'edit', 'delete', 'reorder', 'suggest', 'plan', 'unknown'] },
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

module.exports = {
  intentSchema,
  ollamaSchema,
  listSchema,
  readSchema,
  addSchema,
  editSchema,
  reorderSchema,
  suggestSchema,
  planSchema,
  unknownSchema,
}
