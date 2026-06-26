// Standalone test: exercises all 6 JiraService methods against WIRE.
// Run from server/: node src/mcp/test-jira.js
// Requires JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN in server/.env

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })

const jira = require('./jira-service')

async function run() {
  console.log('Connecting to mcp-atlassian...')
  await jira.init()
  console.log('Connected.\n')

  // 1. Search
  console.log('── jira.searchIssues ──')
  const issues = await jira.searchIssues('project = WIRE ORDER BY created DESC')
  console.log(`Found ${issues.length} issue(s)`)
  if (issues.length > 0) console.log('First:', JSON.stringify(issues[0], null, 2))

  // 2. Get single issue
  const existingKey = issues[0]?.key
  if (existingKey) {
    console.log(`\n── jira.getIssue(${existingKey}) ──`)
    const issue = await jira.getIssue(existingKey)
    console.log(JSON.stringify(issue, null, 2))
  }

  // 3. Create throwaway
  console.log('\n── jira.createIssue ──')
  const created = await jira.createIssue({
    projectKey: 'WIRE',
    summary: '[test] mcp-jira P1 smoke test — delete me',
    issueType: 'Task',
    description: 'Auto-created by test-jira.js to validate the MCP wrapper end-to-end.',
  })
  console.log('Created:', JSON.stringify(created, null, 2))
  const testKey = created?.key
  if (!testKey) throw new Error('createIssue did not return a key — aborting to avoid orphaned issues')

  // 4. Update
  console.log(`\n── jira.updateIssue(${testKey}) ──`)
  const updated = await jira.updateIssue(testKey, { summary: '[test] mcp-jira P1 smoke test — updated' })
  console.log('Updated:', JSON.stringify(updated, null, 2))

  // 5. Transition — fetch real transition IDs first
  console.log(`\n── jira.callTool jira_get_transitions(${testKey}) ──`)
  const { jiraClient } = await import('./jira-client.mjs')
  const transitions = await jiraClient.callTool('jira_get_transitions', { issue_key: testKey })
  console.log('Available transitions:', JSON.stringify(transitions, null, 2))

  if (transitions?.transitions?.length > 0) {
    const firstId = String(transitions.transitions[0].id)
    console.log(`\n── jira.transitionIssue(${testKey}, ${firstId}) ──`)
    await jira.transitionIssue(testKey, firstId)
    console.log('Transitioned OK')
  }

  // 6. Delete
  console.log(`\n── jira.deleteIssue(${testKey}) ──`)
  await jira.deleteIssue(testKey)
  console.log('Deleted OK')

  await jira.shutdown()
  console.log('\nAll checks passed.')
}

run().catch(err => {
  console.error('Test failed:', err.message)
  if (err.code) console.error('Error code:', err.code)
  process.exit(1)
})
