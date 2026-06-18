const store = require('../store')
const { isConfigured, callTool } = require('./mcpClient')

const WIRE_SOURCE = process.env.MCP_SOURCE || 'wire'

// Tool names — defaults are placeholders confirmed/overridden after running
// `npm run mcp:discover` against the real WIRE server.
const TOOL = {
  search: process.env.MCP_TOOL_SEARCH || 'search_issues',
  create: process.env.MCP_TOOL_CREATE || 'create_issue',
  update: process.env.MCP_TOOL_UPDATE || 'update_issue',
}

// ─── normalization ────────────────────────────────────────────────────────────

const STATUS_MAP = {
  open: 'todo',
  todo: 'todo',
  backlog: 'todo',
  'to do': 'todo',
  in_progress: 'in_progress',
  'in progress': 'in_progress',
  doing: 'in_progress',
  started: 'in_progress',
  done: 'done',
  closed: 'done',
  completed: 'done',
  resolved: 'done',
  scheduled: 'scheduled',
}

const PRIORITY_MAP = {
  lowest: 'low',
  low: 'low',
  minor: 'low',
  medium: 'medium',
  normal: 'medium',
  major: 'high',
  high: 'high',
  highest: 'critical',
  critical: 'critical',
  urgent: 'critical',
  blocker: 'critical',
}

function normStatus(v) {
  return STATUS_MAP[String(v || '').toLowerCase()] || 'todo'
}

function normPriority(v) {
  return PRIORITY_MAP[String(v || '').toLowerCase()] || 'medium'
}

// ─── mapping (field names finalized from discovery output) ─────────────────────

function toTask(issue) {
  const now = new Date().toISOString()
  return {
    id: String(issue.id || issue.key),
    source: WIRE_SOURCE,
    title: issue.title || issue.summary || '(untitled)',
    description: issue.description || '',
    status: normStatus(issue.status),
    priority: normPriority(issue.priority),
    assignee: issue.assignee || null,
    creator: issue.creator || issue.reporter || null,
    tags: issue.tags || issue.labels || [],
    due_date: issue.due_date || issue.dueDate || null,
    created_at: issue.created_at || issue.created || now,
    updated_at: issue.updated_at || issue.updated || now,
    url: issue.url || null,
    subtasks: issue.subtasks || [],
    attachments: issue.attachments || [],
    comments_count: issue.comments_count ?? 0,
    estimate_hours: issue.estimate_hours ?? null,
    logged_hours: issue.logged_hours ?? null,
  }
}

// MCP tool results come back as a content array; pull the JSON payload out.
function parseContent(content) {
  if (!Array.isArray(content)) return content
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      try {
        return JSON.parse(part.text)
      } catch {
        // not JSON — ignore
      }
    }
  }
  return null
}

function extractIssues(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.issues)) return payload.issues
  if (Array.isArray(payload.results)) return payload.results
  if (Array.isArray(payload.tasks)) return payload.tasks
  return []
}

// ─── public API ───────────────────────────────────────────────────────────────

async function syncTasks() {
  const args = {}
  if (process.env.MCP_QUERY) args.query = process.env.MCP_QUERY
  const content = await callTool(TOOL.search, args)
  const issues = extractIssues(parseContent(content))
  const rows = issues.map(toTask)
  return store.upsertTasks(rows)
}

async function createTask(fields) {
  const content = await callTool(TOOL.create, fields)
  return parseContent(content)
}

async function editTask(id, fields) {
  const content = await callTool(TOOL.update, { id, ...fields })
  return parseContent(content)
}

module.exports = { WIRE_SOURCE, isConfigured, syncTasks, createTask, editTask, toTask }
