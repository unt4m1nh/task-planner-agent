require('dotenv').config()

const { isConfigured, listMcpTools, disconnect } = require('./mcpClient')

async function main() {
  if (!isConfigured()) {
    console.error('MCP_SERVER_URL and MCP_PAT must be set in server/.env')
    process.exit(1)
  }

  const tools = await listMcpTools()
  console.log(`\nDiscovered ${tools.length} tool(s):\n`)
  for (const t of tools) {
    console.log(`● ${t.name}`)
    if (t.description) console.log(`  ${t.description}`)
    console.log(`  inputSchema: ${JSON.stringify(t.inputSchema, null, 2).replace(/\n/g, '\n  ')}\n`)
  }
}

main()
  .catch((err) => {
    console.error('Discovery failed:', err.message)
    process.exitCode = 1
  })
  .finally(disconnect)
