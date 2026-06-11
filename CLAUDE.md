# CLAUDE.md — To-do AI Agent

This is a full-stack todo agent app: a chat-style interface where a small local
LLM classifies user messages into intents and a Node backend executes them
against a shared task store.

`server/CLAUDE.md` and `client/client/CLAUDE.md` hold package-specific
commands and conventions — this file is the source of truth for overall
architecture and design decisions. If they ever disagree, this file wins.

## Project structure

```
todo-agent/
├── task.json        # single source of truth — all reads/writes go through here
├── server/          # Node.js backend (CommonJS)
│   └── src/
└── client/client/   # React 19 + TypeScript + Vite frontend
    └── src/
```

## Running the app

```bash
# Backend (run from server/) — port 3000
npm run dev

# Frontend (run from client/client/) — Vite dev server
npm run dev

# Ollama (run separately, inside WSL) — port 11434
ollama serve
ollama pull qwen3.5:0.8b
```

Both `server/` and `client/client/` must run concurrently during development.

## Architecture

```
POST /api/chat (Hono)
  → classify.js   call Ollama, enforce JSON schema → intent + slots
  → execute.js    switch(intent) → call store
  → return text response to FE
```

There is **no** `GET /api/tasks` endpoint. The frontend communicates only via
`POST /api/chat`; the agent handles all output including listing tasks.

## Design decisions (read before modifying)

**Model: qwen3.5:0.8b (Ollama) is the production model — small, schema enforcement required**
- Always use `think: false` when calling Ollama
- Always pass `format: <JSON Schema>` (constrained decoding, see `agent/schema.js`)
- Keep prompts short, intents closed and enumerable
- Validate JSON output → retry once → fall back to `unknown` with a clarification if still invalid

**LLM provider is swappable for comparison testing — `LLM_PROVIDER` in `server/.env`**
- `ollama` (default) → local `qwen3.5:0.8b` via `format: <JSON Schema>`
- `gemini` → Gemini API (`GEMINI_API_KEY`, `GEMINI_MODEL`, default `gemini-2.5-flash`)
  via `responseSchema` + `thinkingConfig: { thinkingBudget: 0 }` (Gemini's `think: false` equivalent)
- `llm.js` converts the shared `ollamaSchema` into Gemini's stricter schema subset
  (`toGeminiSchema` — uppercase types, drops `pattern`/`const`/`additionalProperties`/etc.)
  so both providers classify against the same constraints
- This is for **side-by-side quality comparison only** — qwen3.5:0.8b remains the
  documented production model; don't remove the small-model design constraints above

**7 intents**
`list` | `read` | `add` | `edit` | `reorder` | `suggest` | `unknown`

- `list`   — list all tasks, or filter by status/priority/source/tags/keyword
- `read`   — get a single task by id (needs `id`)
- `add`    — create a new task (needs `title`)
- `edit`   — change an existing task: direct field replacements (`fields` object)
             and/or appending to a field — tags, subtasks, title (`append: { field, value }`).
             At least one of `fields`/`append` must be present (needs `id`)
- `reorder`— move a task to top, bottom, before, or after another (needs `id`, `to`)
- `suggest`— recommend what to work on next. The model only extracts
             `{ availableMinutes?, mood? }` — it does **not** pick tasks.
             `agent/suggest.js` runs a pure scoring function (priority + due-date
             proximity + estimated remaining time vs. `availableMinutes`, nudged
             by `mood`) and `execute.js` formats the picks into a reply
- `unknown`— cannot determine intent — set `clarification` to ask the user

**Task order = array order in `task.json`**
No `order` field. `reorderTask()` rewrites the full array in the new sequence.

**`reorder` uses a single move instruction**
Model fills `{ id, to: "top"|"bottom"|"before"|"after", refId? }`.
Code computes the new array — do not ask the model to output the full ordered id list.

**`task.json` is the single source of truth**
It lives at the repo root and contains `{ meta, tasks }`. All writes go
through `store.js`, which keeps `meta.total` in sync with `tasks.length`.

## File structure

```
server/src/
  index.js           Hono routes: POST /api/chat
  store.js           read/write/filter/append/update/reorder against task.json
  llm.js             Ollama client (buildTaskContext, generate — format, think:false)
  adapters/          (placeholder — empty, no source-specific adapters yet)
  agent/
    schema.js        JSON Schema per intent, enforced via Ollama `format`
    classify.js      build prompt → call model → parse → validate → retry → execute
    execute.js       switch(intent) → store, formats text responses
    suggest.js       pure scoring function for the `suggest` intent
client/client/src/
  App.tsx            currently the default Vite/React scaffold — chat UI not built yet
```

## Task schema (as stored in `task.json`)

```ts
{
  id: string                // e.g. "JIRA-1042" or "manual-<timestamp>"
  source: "jira" | "notion" | "google_calendar" | "manual"
  title: string
  description: string
  status: "todo" | "in_progress" | "done" | "scheduled"
  priority: "low" | "medium" | "high" | "critical"
  assignee: { id, name, email, avatar } | null
  creator: { id, name, email } | null
  tags: string[]
  due_date: string | null   // ISO 8601, e.g. "2026-06-15T00:00:00Z"
  created_at: string
  updated_at: string
  url: string | null
  subtasks: { id, title, status }[]
  attachments: unknown[]
  comments_count: number
  estimate_hours: number | null
  logged_hours: number | null
}
```

## Code conventions

- **Server**: CommonJS (`require`/`module.exports`) — see `server/CLAUDE.md`
- **Client**: ESM + TypeScript — see `client/client/CLAUDE.md`
- No unnecessary comments in code
- Hono handler pattern: parse body → validate → classify → execute → `c.json(result)`
- No streaming for `/api/chat` — responses are short, plain `await` is sufficient

## Status / known gaps

- Frontend is still the default Vite scaffold — no chat UI, no `lib/api.ts` yet
- `adapters/` is empty — no Jira/Notion/Calendar ingestion adapters exist
- Not a git repository
