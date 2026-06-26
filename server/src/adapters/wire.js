const store = require('../store')
const jira = require('../mcp/jira-service')

const WIRE_SOURCE = process.env.MCP_SOURCE || 'wire'

// Project key used when creating new issues. Override via MCP_PROJECT_KEY.
const DEFAULT_PROJECT_KEY = process.env.MCP_PROJECT_KEY || 'DP05210911'

// ─── status / priority normalization ─────────────────────────────────────────

const STATUS_MAP = {
  open: 'todo',
  todo: 'todo',
  backlog: 'todo',
  'to do': 'todo',
  in_progress: 'in_progress',
  'in progress': 'in_progress',
  'in development': 'in_progress',
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

// ─── Task normalization ───────────────────────────────────────────────────────

// JiraIssue (from jira-service) → unified app Task schema
function toTask(issue) {
  const now = new Date().toISOString()
  return {
    id: issue.key || String(issue.id),
    source: WIRE_SOURCE,
    title: issue.summary || '(untitled)',
    description: issue.description || '',
    status: normStatus(issue.status),
    priority: normPriority(issue.priority),
    assignee: issue.assignee ? { id: null, name: issue.assignee, email: null, avatar: null } : null,
    creator: null,
    tags: [],
    due_date: issue.dueDate || null,
    created_at: issue.createdAt || now,
    updated_at: issue.updatedAt || now,
    url: issue.url || null,
    subtasks: [],
    attachments: [],
    comments_count: 0,
    estimate_hours: null,
    logged_hours: null,
  }
}

// ─── configuration ────────────────────────────────────────────────────────────

function isConfigured() {
  const pat = process.env.JIRA_PERSONAL_TOKEN || process.env.JIRA_API_TOKEN
  return Boolean(process.env.JIRA_URL && pat)
}

// ─── public API ───────────────────────────────────────────────────────────────

// init() connects the mcp-atlassian stdio process — call once at startup.
async function init() {
  if (!isConfigured()) return
  await jira.init()
}

async function shutdown() {
  await jira.shutdown()
}

// Pull issues assigned to the current user (or via MCP_QUERY JQL) into task.json.
async function syncTasks() {
  const jql = process.env.MCP_QUERY || 'assignee = currentUser() ORDER BY updated DESC'
  const issues = await jira.searchIssues(jql)
  const rows = issues.map(toTask)
  return store.upsertTasks(rows)
}

// Create a new Jira issue. Called by nodes-todo for source=wire add intent.
async function createTask(fields) {
  // Derive project key: from explicit field, or env default
  const projectKey = fields.projectKey || DEFAULT_PROJECT_KEY
  const issueType = fields.issueType || 'Story'
  const created = await jira.createIssue({
    projectKey,
    summary: fields.title || fields.summary,
    issueType,
    description: fields.description || fields.title || fields.summary,
    ...(fields.priority && { priority: fields.priority }),
    ...(fields.assignee && { assignee: fields.assignee }),
  })
  // Also upsert into local store so it's immediately visible
  if (created?.key) store.upsertTasks([toTask(created)])
  return created
}

// Update an existing Jira issue. Called by nodes-todo for source=wire edit intent.
async function editTask(id, fields) {
  const updated = await jira.updateIssue(id, {
    ...(fields.title && { summary: fields.title }),
    ...(fields.description && { description: fields.description }),
    ...(fields.priority && { priority: fields.priority }),
    ...(fields.assignee?.name && { assignee: fields.assignee.name }),
  })
  // Reflect the change locally
  if (updated?.key) store.upsertTasks([toTask(updated)])
  return updated
}

module.exports = { WIRE_SOURCE, isConfigured, init, shutdown, syncTasks, createTask, editTask, toTask }
