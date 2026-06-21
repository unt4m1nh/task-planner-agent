# Task Planner Agent

A chat-style to-do agent: a small local LLM classifies user messages into intents
(`list`, `add`, `edit`, `delete`, `reorder`, `suggest`, `plan`, ...) and a Node.js
backend executes them against a shared task store, with human-in-the-loop
confirmation for destructive or ambiguous actions.

```
Browser (React + Vite)
  └─ POST /api/chat ─────────────────────────────┐
                                                  ▼
                                          Hono HTTP server
                                          └─ LangGraph StateGraph
                                               └─ task.json  (store)
                                               └─ Ollama / Gemini (LLM)
                                               └─ checkpoints.db (SQLite)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full data flow and module
breakdown, and [CLAUDE.md](CLAUDE.md) for design decisions and conventions.

## Project structure

```
task-planner-agent/
├── task.json        # single source of truth — all reads/writes go through here
├── server/          # Node.js backend (CommonJS)
└── client/client/   # React 19 + TypeScript + Vite frontend
```

## Prerequisites

- Node.js
- [Ollama](https://ollama.com/) running locally with the `gemma4:e2b` model
  (or a Gemini API key, see below)

## Setup

```bash
# Backend
cd server
npm install

# Frontend
cd client/client
npm install
```

Pull the local model for Ollama:

```bash
ollama pull gemma4:e2b
```

## Running

Three processes run concurrently during development:

```bash
# Ollama (inside WSL on Windows)
ollama serve

# Backend — port 3000
cd server
npm run dev

# Frontend — Vite dev server
cd client/client
npm run dev
```

## LLM providers

The LLM provider is configurable via `LLM_PROVIDER` in `server/.env`:

- `ollama` (default) — local `gemma4:e2b`
- `gemini` — Gemini API (requires `GEMINI_API_KEY`)

The provider can also be switched at runtime from the sidebar in the UI, or via
`POST /api/provider`.

## API

The frontend talks to the backend through a single thread-based endpoint:

```
POST /api/chat
  { messages: [{ role: "user", content: "..." }], threadId? }   # fresh turn
  { resume: "approve" | "reject" | "<text>", threadId }         # resume after HITL pause
```

There is no `GET /api/tasks` — all task state lives behind `/api/chat`.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system overview and module map
- [CLAUDE.md](CLAUDE.md) — architecture decisions, intents, task schema
- [server/CLAUDE.md](server/CLAUDE.md) — backend commands and conventions
- [client/client/CLAUDE.md](client/client/CLAUDE.md) — frontend commands and conventions
