# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# To-do AI Agent

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
  → parseDailyPlanner()  slash command — injects plannerSlots, skips route model call
  → graph.mjs (LangGraph) — compiled StateGraph with checkpointer (SqliteSaver)
      router            classify domain → "todo" | "planner" | "unknown"
      todo_understand   validate slots, decide clarify/confirm/execute
      todo_execute      run store operation (WIRE-aware)
      planner_understand map to rank/plan/reorder sub-intent, load tasks
      planner_rank      LLM suggest via suggest-tasks/SKILL.md (free-text, no schema)
      planner_plan      LLM plan via plan-day/SKILL.md (free-text, no schema)
      planner_plan_review HITL — always fires; approve/reject the LLM-generated schedule
      reorder_confirm   HITL — approve/reject the move
      todo_confirm      HITL — approve/reject destructive (edit/delete)
      todo_clarify      HITL — ask for missing required slot
      router_clarify    HITL — ask user to rephrase when domain unknown
  → interrupted? return { threadId, awaitingInput: { kind, question|summary } }
  → complete?   return { threadId, intent, response, tasks?, schedule? }
```

**`POST /api/chat` is thread-based.** Every request includes a `threadId`; the LangGraph checkpointer (SQLite) restores state so interrupted nodes can be resumed.

- **Fresh turn**: `{ messages: [{ role: "user", content: "..." }], threadId? }`
- **Resume turn**: `{ resume: "approve"|"reject"|"<text>", threadId }`

There is **no** `GET /api/tasks` endpoint. The frontend communicates only via `POST /api/chat`.

### Other API endpoints

- `GET /api/provider` — returns current `{ provider }` (`"ollama"` or `"gemini"`)
- `POST /api/provider` — switches provider at runtime `{ provider: "ollama"|"gemini" }`; updates `process.env.LLM_PROVIDER`
- `/daily-planner [9-17 | 09:00-17:00 | 4h | 240m]` — slash command; parsed by `parseDailyPlanner()` in `index.js` and injected as `plannerSlots` into graph state, bypassing the route model call

## Design decisions (read before modifying)

**Model: qwen3.5:0.8b (Ollama) is the production model — small, schema enforcement required**
- Always use `think: false` when calling Ollama
- Always pass `format: <JSON Schema>` (constrained decoding, see `agent/classify/schema.js`)
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

**9 intents**
`list` | `read` | `add` | `edit` | `delete` | `reorder` | `suggest` | `plan` | `unknown`

- `list`   — list all tasks, or filter by status/priority/source/tags/keyword
- `read`   — get a single task by id (needs `id`)
- `add`    — create a new task (needs `title`)
- `edit`   — change an existing task: direct field replacements (`fields` object)
             and/or appending to a field — tags, subtasks, title (`append: { field, value }`).
             At least one of `fields`/`append` must be present (needs `id`)
- `delete` — permanently remove a task from `task.json` (needs `id`); always gated by `todo_confirm` HITL
- `reorder`— move a task to top, bottom, before, or after another (needs `id`, `to`)
- `suggest`— recommend what to work on next. The model only extracts
             `{ availableMinutes?, mood? }` — it does **not** pick tasks.
             `agent/scheduling/suggest.js` runs a pure scoring function (priority + due-date
             proximity + estimated remaining time vs. `availableMinutes`, nudged
             by `mood`) and `execute.js` formats the picks into a reply
- `plan`    — build a time-blocked schedule for a day. The model only extracts
             `{ date?, startTime?, endTime?, availableMinutes? }` — it does **not**
             schedule. `agent/scheduling/planner.js` runs a pure function: it reuses
             `suggest.js`'s scoring (plus workflow bonuses — finish in-progress
             work first, overdue next, day's scheduled tasks up front), then walks
             a clock cursor across the work window slicing tasks into blocks,
             inserting breaks and marking partials. `execute.js` formats the plan
             (and returns the structured `schedule` alongside the text)
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
  index.js           Hono routes, parseDailyPlanner, thread-based /api/chat handler
  store.js           read/write/filter/append/update/reorder/delete against task.json
  llm.js             LLM client: buildTaskContext, generate (format, think:false for Ollama)
  adapters/
    discover.js      adapter registry / discovery
    mcpClient.js     MCP SSE client for WIRE integration
    wire.js          WIRE-specific adapter (list/read/write via MCP)
  agent/
    execute.js       legacy switch(intent) handler (kept, not called by index.js post-v2)
    classify/
      schema.js      JSON Schema per intent, enforced via Ollama `format`
      classify.js    build prompt → call model → parse → validate → retry → fallback
      contract.js    validateTodoSlots, isDestructive, describeAction (node entry guards)
    graph/
      graph.mjs      LangGraph StateGraph — AgentState, all nodes, edges, SqliteSaver checkpointer
      state.mjs      AgentState Annotation.Root, HITL config map
      edges.mjs      conditional edge functions
      nodes-router.mjs    router, router_clarify
      nodes-todo.mjs      todo_understand/clarify/confirm/execute
      nodes-planner.mjs   planner_understand/rank/plan/plan_review/complete, reorder_confirm
      utils.mjs      shared node helpers (lastUserMsg, fmt, agentLog, syncWire, ...)
    scheduling/
      suggest.js     pure scoring function for the `suggest` intent
      planner.js     pure scheduling algorithm (kept as reference; graph now uses plan-day/SKILL.md + LLM)
      plan-adjust.js pure patch application for the planner ADJUST flow
      scheduler.js   pure clock-cursor scheduler (blocks, breaks, partials)
    skills/
      suggest-tasks/SKILL.md  scoring + reply spec for the suggest intent (loaded as LLM system prompt)
      plan-day/SKILL.md       scheduling algorithm spec for the plan intent (loaded as LLM system prompt)
      adjust-plan/SKILL.md    plan-adjustment spec for the planner ADJUST flow (loaded as LLM system prompt)
checkpoints.db       SqliteSaver database (created on first run, gitignored)
client/client/src/
  App.tsx            root layout: <Sidebar /> + <ChatPanel />
  ChatPanel.tsx      chat thread UI — threadId persistence, clarify/approve HITL widgets
  Sidebar.tsx        model switcher (calls GET/POST /api/provider)
  lib/api.ts         typed fetch wrappers: sendChat, resumeChat, getProvider, setProvider
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

## WIRE MCP integration

`adapters/wire.js` syncs issues from a WIRE (internal Jira-like) server via MCP SSE. When configured, `list` and `read` intents pull live WIRE issues into `task.json`, and `add`/`edit` on wire-sourced tasks call MCP tools directly instead of writing to the JSON file.

Required env vars (all optional — integration is skipped if unset):

```
MCP_SERVER_URL=https://wire.lgcns.com/wiremcp/sse
MCP_WORK_KEY=   # Work-Key header token
MCP_WIKI_KEY=   # Wiki-Key header token (optional)
MCP_CODE_KEY=   # Code-Key header token (optional)
MCP_SOURCE=wire # source id for synced tasks
MCP_QUERY=      # optional filter for which issues to sync
```

## LangGraph control plane (Phase 2)

The agent runs inside a LangGraph `StateGraph` (`agent/graph/graph.mjs`, ESM). The server stays CommonJS — the graph is loaded via a single `import()` at startup and cached.

**State** (`AgentState`): `messages` (append-reducer), `route`, `todoSlots`, `plannerSlots`, `tasks`, `pendingAction`, `result`.

**HITL**: `interrupt()` pauses the graph at `todo_confirm`, `todo_clarify`, `router_clarify`, `reorder_confirm`, and `planner_overload_review`. The handler detects `result.__interrupt__[0].value` and returns `{ awaitingInput }` to the client. The client resumes with `{ resume, threadId }`.

**Checkpointer**: `SqliteSaver` (`checkpoints.db` at repo root) — state survives server restarts. Each browser session generates a UUID as `threadId` which is sent on every turn.

**Module system**: `graph.mjs` uses `createRequire` to import CJS modules (`classify.js`, `store.js`, `suggest.js`, `planner.js`, `wire.js`, `contract.js`). Do not add ESM imports to those files.

**HITL config map** (in `graph.mjs`): flip any `HITL[nodeName]` to `true` to gate that node without other code changes.

## Status / known gaps

- `adapters/` has WIRE integration; no Jira/Notion/Google Calendar adapters yet
- `suggest-tasks/SKILL.md` documents the scoring spec but `suggest.js` is the implementation — keep them in sync when changing scoring logic
- `execute.js` is kept for reference but is no longer called by `index.js`; the graph nodes in `graph.mjs` contain the execution logic
