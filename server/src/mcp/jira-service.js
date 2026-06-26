// CJS-facing Jira service — loads jira-client.mjs via dynamic import(),
// following the same ESM-isolation pattern used for agent/graph/graph.mjs.

let _clientPromise = null

function getClient() {
  if (!_clientPromise) {
    _clientPromise = import('./jira-client.mjs').then(m => m.jiraClient)
  }
  return _clientPromise
}

// Normalize raw Jira issue shape → JiraIssue (see types.js).
// mcp-atlassian returns different shapes per operation:
//   search/get  → flat issue object
//   create      → { message, issue: { ... } }
function normalizeIssue(raw) {
  if (!raw) return null
  // Unwrap create response: { message, issue }
  const src = raw.issue || raw
  // Support both flat (mcp-atlassian) and nested (.fields) shapes
  const f = src.fields || src
  const key = src.key || f.key || ''
  return {
    id: src.id || f.id || '',
    key,
    summary: f.summary || '',
    description: f.description?.content?.[0]?.content?.[0]?.text ?? (typeof f.description === 'string' ? f.description : null),
    status: f.status?.name || f.status?.category || '',
    issueType: f.issue_type?.name || f.issuetype?.name || '',
    priority: f.priority?.name || null,
    assignee: f.assignee?.display_name || f.assignee?.displayName || null,
    dueDate: f.due_date || f.duedate || null,
    createdAt: f.created || '',
    updatedAt: f.updated || '',
    url: `${(process.env.JIRA_URL || '').trim()}/browse/${key}`,
  }
}

async function init() {
  const client = await getClient()
  await client.connect()
}

async function shutdown() {
  const client = await getClient()
  await client.close()
}

/** @param {string} jql @returns {Promise<import('./types').JiraIssue[]>} */
async function searchIssues(jql) {
  const client = await getClient()
  const result = await client.callTool('jira_search', { jql })
  const issues = result?.issues || result || []
  return issues.map(normalizeIssue)
}

/** @param {string} id @returns {Promise<import('./types').JiraIssue>} */
async function getIssue(id) {
  const client = await getClient()
  const result = await client.callTool('jira_get_issue', { issue_key: id })
  return normalizeIssue(result)
}

/**
 * @param {import('./types').CreateIssueInput} fields
 * @returns {Promise<import('./types').JiraIssue>}
 */
async function createIssue(fields) {
  const client = await getClient()
  const args = {
    project_key: fields.projectKey,
    summary: fields.summary,
    issue_type: fields.issueType || 'Story',
    description: fields.description || fields.summary,
    ...(fields.priority && { priority: fields.priority }),
    ...(fields.assignee && { assignee: fields.assignee }),
  }
  const result = await client.callTool('jira_create_issue', args)
  return normalizeIssue(result)
}

/**
 * @param {string} id
 * @param {import('./types').UpdateIssueInput} fields
 * @returns {Promise<import('./types').JiraIssue>}
 */
async function updateIssue(id, fields) {
  const client = await getClient()
  const fieldUpdates = {
    ...(fields.summary && { summary: fields.summary }),
    ...(fields.description && { description: fields.description }),
    ...(fields.priority && { priority: { name: fields.priority } }),
    ...(fields.assignee && { assignee: { name: fields.assignee } }),
  }
  const args = { issue_key: id, fields: JSON.stringify(fieldUpdates) }
  const result = await client.callTool('jira_update_issue', args)
  return normalizeIssue(result)
}

/** @param {string} id @param {string} transitionId @returns {Promise<void>} */
async function transitionIssue(id, transitionId) {
  const client = await getClient()
  await client.callTool('jira_transition_issue', { issue_key: id, transition_id: transitionId })
}

/** @param {string} id @returns {Promise<void>} */
async function deleteIssue(id) {
  const client = await getClient()
  await client.callTool('jira_delete_issue', { issue_key: id })
}

module.exports = { init, shutdown, searchIssues, getIssue, createIssue, updateIssue, transitionIssue, deleteIssue }
