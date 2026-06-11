# CLAUDE.md (server)

Package-specific notes for the backend. See the root `CLAUDE.md` for overall
architecture, intents, design decisions, and the task schema.

## Commands (run from `todo-agent/server/`)

```bash
npm start        # Run the server (port 3000)
npm run dev      # Run with --watch for auto-restart on file changes
```

## Conventions

- **CommonJS** (`"type": "commonjs"` in `package.json`) — use `require()` /
  `module.exports`, not ES module `import`/`export`
- Reads/writes go through `store.js`; nothing else should touch `task.json` directly
