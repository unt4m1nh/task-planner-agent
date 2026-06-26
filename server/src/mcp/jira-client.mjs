import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { execSync } from 'child_process'
import path from 'path'

// Resolve uvx absolute path — required under WSL non-login shells where PATH is limited
function resolveUvx() {
  try {
    return execSync('which uvx', { encoding: 'utf8' }).trim()
  } catch {
    // Fallback to common install location from the official uv installer
    return path.join(process.env.HOME || '/root', '.local', 'bin', 'uvx')
  }
}

function buildJiraEnv() {
  const { JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN } = process.env
  if (!JIRA_URL || !JIRA_USERNAME || !JIRA_API_TOKEN) {
    throw new Error('Missing required env vars: JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN')
  }
  return {
    ...process.env,
    JIRA_URL,
    JIRA_USERNAME,
    JIRA_API_TOKEN,
    // Prevent the token from leaking via debug outputs in the child process
    DEBUG: '',
  }
}

// Unwrap MCP tool result content blocks → parsed object or raw text
function unwrapResult(result) {
  const content = result?.content
  if (!Array.isArray(content) || content.length === 0) return null
  for (const block of content) {
    if (block.type === 'text') {
      try { return JSON.parse(block.text) } catch { return block.text }
    }
  }
  return null
}

class JiraClient {
  constructor() {
    this._client = null
    this._transport = null
  }

  async connect() {
    if (this._client) return

    const uvxPath = resolveUvx()
    this._transport = new StdioClientTransport({
      command: uvxPath,
      args: ['mcp-atlassian'],
      env: buildJiraEnv(),
    })

    this._client = new Client({ name: 'todo-agent', version: '1.0.0' })
    await this._client.connect(this._transport)
  }

  async close() {
    if (this._client) {
      await this._client.close()
      this._client = null
      this._transport = null
    }
  }

  async callTool(name, args) {
    if (!this._client) throw new Error('JiraClient not connected — call connect() first')
    let result
    try {
      result = await this._client.callTool({ name, arguments: args })
    } catch (err) {
      // Classify common failure modes
      const msg = err?.message || ''
      if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
        const e = new Error(`Jira auth error: ${msg}`)
        e.code = 'JIRA_AUTH_ERROR'
        throw e
      }
      if (msg.includes('404') || msg.includes('not found')) {
        const e = new Error(`Jira issue not found: ${msg}`)
        e.code = 'JIRA_NOT_FOUND'
        throw e
      }
      if (msg.includes('ENOENT') || msg.includes('spawn') || msg.includes('transport')) {
        const e = new Error(`MCP transport error (uvx/mcp-atlassian not reachable): ${msg}`)
        e.code = 'MCP_TRANSPORT_DOWN'
        throw e
      }
      throw err
    }

    if (result?.isError) {
      const detail = unwrapResult(result) || JSON.stringify(result.content)
      const e = new Error(`Jira tool "${name}" returned an error: ${JSON.stringify(detail)}`)
      e.code = 'JIRA_TOOL_ERROR'
      throw e
    }

    return unwrapResult(result)
  }

  async listTools() {
    if (!this._client) throw new Error('JiraClient not connected')
    const { tools } = await this._client.listTools()
    return tools
  }
}

// Singleton — one long-lived connection per process
const client = new JiraClient()

export { client as jiraClient, JiraClient }
