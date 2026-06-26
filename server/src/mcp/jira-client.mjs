import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { execSync } from 'child_process'
import path from 'path'

// Resolve mcp-atlassian binary path.
// Prefer the directly-installed tool (uv tool install mcp-atlassian) over uvx
// so the server doesn't need PyPI access at startup.
function resolveMcpAtlassian() {
  // uv tool install puts the binary here
  const direct = path.join(process.env.HOME || '/root', '.local', 'bin', 'mcp-atlassian')
  try {
    execSync(`test -x "${direct}"`, { stdio: 'ignore' })
    return direct
  } catch {}
  // Fallback: try uvx (will download on first run, needs PyPI access)
  try {
    return execSync('which uvx', { encoding: 'utf8' }).trim()
  } catch {
    return path.join(process.env.HOME || '/root', '.local', 'bin', 'uvx')
  }
}

function buildJiraEnv() {
  const { JIRA_URL, JIRA_API_TOKEN, JIRA_USERNAME, JIRA_PERSONAL_TOKEN, REQUESTS_CA_BUNDLE, SSL_CERT_FILE } = process.env
  if (!JIRA_URL) throw new Error('Missing required env var: JIRA_URL')

  // Server/DC: prefer JIRA_PERSONAL_TOKEN; fall back to JIRA_API_TOKEN
  const pat = JIRA_PERSONAL_TOKEN || JIRA_API_TOKEN
  if (!pat) throw new Error('Missing required env var: JIRA_PERSONAL_TOKEN (or JIRA_API_TOKEN for Server/DC)')

  return {
    ...process.env,
    JIRA_URL: JIRA_URL.trim(),
    JIRA_PERSONAL_TOKEN: pat.trim(),
    // Keep username/api_token in env too in case the server auto-detects Cloud
    ...(JIRA_USERNAME && { JIRA_USERNAME: JIRA_USERNAME.trim() }),
    ...(JIRA_API_TOKEN && { JIRA_API_TOKEN: JIRA_API_TOKEN.trim() }),
    // Pass through corporate CA cert so mcp-atlassian can verify SSL
    ...(REQUESTS_CA_BUNDLE && { REQUESTS_CA_BUNDLE }),
    ...(SSL_CERT_FILE && { SSL_CERT_FILE }),
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

    const bin = resolveMcpAtlassian()
    const isMcpAtlassianDirect = bin.endsWith('mcp-atlassian')
    this._transport = new StdioClientTransport({
      command: bin,
      args: isMcpAtlassianDirect ? [] : ['--system-certs', 'mcp-atlassian'],
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
