let clientPromise = null

// WIRE authenticates with per-module token headers, not OAuth/Bearer.
function authHeaders() {
  const headers = {}
  if (process.env.MCP_WIKI_KEY) headers['Wiki-Key'] = process.env.MCP_WIKI_KEY
  if (process.env.MCP_WORK_KEY) headers['Work-Key'] = process.env.MCP_WORK_KEY
  if (process.env.MCP_CODE_KEY) headers['Code-Key'] = process.env.MCP_CODE_KEY
  return headers
}

function isConfigured() {
  return Boolean(process.env.MCP_SERVER_URL && Object.keys(authHeaders()).length)
}

async function connect() {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

  const url = process.env.MCP_SERVER_URL
  const headers = authHeaders()
  if (!url || !Object.keys(headers).length) {
    throw new Error('MCP_SERVER_URL and at least one of MCP_WIKI_KEY/MCP_WORK_KEY/MCP_CODE_KEY must be set')
  }

  // Authenticated SSE GET stream: EventSource can't carry headers, so pass a
  // fetch that injects the WIRE key headers.
  const authFetch = (input, init = {}) =>
    fetch(input, { ...init, headers: { ...(init.headers || {}), ...headers } })

  // Prefer Streamable HTTP (current spec); fall back to the older HTTP+SSE
  // transport, which is what "Error POSTing to endpoint" usually indicates.
  const transports = [
    async () => {
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      )
      return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })
    },
    async () => {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js')
      return new SSEClientTransport(new URL(url), {
        requestInit: { headers },
        eventSourceInit: { fetch: authFetch },
      })
    },
  ]

  let lastErr
  for (const make of transports) {
    const transport = await make()
    const client = new Client({ name: 'todo-agent', version: '1.0.0' }, { capabilities: {} })
    try {
      await client.connect(transport)
      console.log(`[mcp] connected to ${url} via ${transport.constructor.name}`)
      return client
    } catch (err) {
      lastErr = err
      console.warn(`[mcp] ${transport.constructor.name} failed: ${err.message}`)
      try { await transport.close() } catch {}
    }
  }
  throw new Error(`could not connect to MCP server: ${lastErr?.message || 'unknown error'}`)
}

function getClient() {
  if (!clientPromise) {
    clientPromise = connect().catch((err) => {
      clientPromise = null
      throw err
    })
  }
  return clientPromise
}

async function listMcpTools() {
  const client = await getClient()
  const { tools } = await client.listTools()
  return tools
}

async function callTool(name, args) {
  const client = await getClient()
  const res = await client.callTool({ name, arguments: args || {} })
  if (res.isError) {
    const text = (res.content || []).map((c) => c.text).filter(Boolean).join('\n')
    throw new Error(`MCP tool "${name}" failed: ${text || 'unknown error'}`)
  }
  return res.content
}

async function disconnect() {
  if (!clientPromise) return
  try {
    const client = await clientPromise
    await client.close()
  } catch {
    // ignore
  }
  clientPromise = null
}

module.exports = { isConfigured, listMcpTools, callTool, disconnect }
