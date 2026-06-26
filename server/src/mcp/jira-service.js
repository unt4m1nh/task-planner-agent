// CJS-facing Jira service — loads jira-client.mjs via dynamic import(),
// following the same ESM-isolation pattern used for agent/graph/graph.mjs.

let _clientPromise = null

function getClient() {
  if (!_clientPromise) {
    _clientPromise = import('./jira-client.mjs').then(m => m.jiraClient)
  }
  return _clientPromise
}

// Normalize raw Jira issue shape → JiraIssue (see types.js)
function normalizeIssue(raw) {
  if (!raw) return null
  const fields = raw.fields || {}
  return {
    id: raw.id,
    key: raw.key,
    summary: fields.summary || '',
    description: fields.description?.content?.[0]?.content?.[0]?.text ?? fields.description ?? null,
    status: fields.status?.name || '',
    issueType: fields.issuetype?.name || '',
    priority: fields.priority?.name || null,
    assignee: fields.assignee?.displayName || null,
    dueDate: fields.duedate || null,
    createdAt: fields.created || '',
    updatedAt: fields.updated || '',
    url: raw.self ? `${process.env.JIRA_URL}/browse/${raw.key}` : '',
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
    issue_type: fields.issueType || 'Task',
    ...(fields.description && { description: fields.description }),
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
  const args = {
    issue_key: id,
    ...(fields.summary && { summary: fields.summary }),
    ...(fields.description && { description: fields.description }),
    ...(fields.priority && { priority: fields.priority }),
    ...(fields.assignee && { assignee: fields.assignee }),
  }
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
