# Architecture

## Overview

Todo Agent is a chat-driven task management app. A React frontend sends every user message to a Node.js backend that runs a [LangGraph](https://langchain-ai.github.io/langgraphjs/) `StateGraph`. The graph classifies the intent, executes the action, and—where needed—pauses to ask the user for confirmation or clarification before proceeding.

```
Browser (React + Vite)
  └─ POST /api/chat ──────────────────────────────────┐
                                                       ▼
                                               Hono HTTP server
                                               └─ LangGraph StateGraph
                                                    └─ task.json  (store)
                                                    └─ Ollama / Gemini (LLM)
                                                    └─ checkpoints.db (SQLite)
```

---

## Project Structure

```
todo-agent/
├── task.json                   # single source of truth for all tasks
├── checkpoints.db              # LangGraph thread state (SqliteSaver)
├── server/src/
│   ├── index.js                # Hono routes, /daily-planner parser
│   ├── store.js                # read / write / filter / reorder / delete on task.json
│   ├── llm.js                  # generate() — Ollama or Gemini, LlmProviderError
│   ├── adapters/
│   │   ├── wire.js             # WIRE MCP adapter (optional)
│   │   └── mcpClient.js        # MCP SSE client
│   └── agent/
│       ├── graph.mjs           # StateGraph assembly + compile (entry point)
│       ├── state.mjs           # AgentState annotation, HITL config flags
│       ├── edges.mjs           # conditional edge functions
│       ├── utils.mjs           # shared helpers (parsePlanText, fmtPlanText, …)
│       ├── nodes-router.mjs    # router, router_clarify nodes
│       ├── nodes-todo.mjs      # todo_understand/clarify/confirm/execute nodes
│       ├── nodes-planner.mjs   # planner_* nodes + reorder_confirm
│       ├── classify.js         # LLM intent classifier (JSON schema enforced)
│       ├── contract.js         # slot validation, isDestructive, describeAction
│       ├── schema.js           # Ollama JSON schema per intent
│       ├── suggest.js          # pure scoring fn for the `suggest` intent
│       ├── planner.js          # pure scheduling algorithm for `plan`
│       ├── suggest-tasks/SKILL.md   # scoring spec (LLM system prompt)
│       └── plan-day/SKILL.md        # scheduling spec (LLM system prompt)
└── client/client/src/
    ├── App.tsx                 # root layout; owns schedule state
    ├── Sidebar.tsx             # model switcher + plan timeline
    ├── ChatPanel.tsx           # chat thread, HITL widgets, plan display
    └── lib/api.ts              # typed fetch wrappers
```

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/chat` | Main entry — fresh turn or HITL resume |
| `GET`  | `/api/provider` | Returns current LLM provider |
| `POST` | `/api/provider` | Switches provider at runtime |

### Fresh turn
```json
{ "messages": [{ "role": "user", "content": "..." }], "threadId": "<uuid>" }
```

### HITL resume
```json
{ "resume": "approve" | "reject" | "<feedback text>", "threadId": "<uuid>" }
```

### Interrupt response (HTTP 202 for clarify, 200 for approve)
```json
{ "ok": true, "threadId": "...", "awaitingInput": { "kind": "clarify|approve", "question": "...", "schedule": {} } }
```

### Completed response
```json
{ "ok": true, "threadId": "...", "response": "...", "tasks": [], "schedule": {} }
```

---

## LangGraph Workflow

The graph is a compiled `StateGraph` persisted via `SqliteSaver` (SQLite). Every browser session has a `threadId`; the checkpointer restores full state on resume so interrupted nodes continue exactly where they paused.

### State (`AgentState`)

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `Message[]` | append-only conversation history |
| `route` | `string` | `"todo"` \| `"planner"` \| `"unknown"` |
| `todoSlots` | `object` | intent + extracted slots from classifier |
| `plannerSlots` | `object` | intent + subIntent + date/time/feedback slots |
| `tasks` | `Task[]` | snapshot loaded by planner_understand |
| `pendingAction` | `object` | data passed to HITL nodes (summary, planResult, …) |
| `result` | `object` | final `{ intent, response, tasks?, schedule? }` |
| `sessionContext` | `object` | persists across turns: activeRoute, lastPlanText, lastSchedule, turnCount |

`sessionContext` uses a **merge reducer** — each turn shallow-merges new keys rather than replacing the whole object, so context accumulates across the conversation.

---

### Graph Topology

```
START
  └─► router
        ├─(todo)──────────► todo_understand
        │                       ├─(clarify)──► todo_clarify ──► todo_understand
        │                       ├─(confirm)──► todo_confirm ──► todo_execute ──► END
        │                       └─(execute)──► todo_execute ──► END
        │
        ├─(planner)────────► planner_understand
        │                       ├─(rank)─────► planner_rank ──► END
        │                       ├─(reorder)──► reorder_confirm ──► END
        │                       ├─(complete)─► planner_complete ──► END
        │                       └─(plan)─────► planner_plan
        │                                           └─────────► planner_plan_review
        │                                                           ├─(approve)──► END
        │                                                           ├─(reject)───► planner_plan  (fresh re-plan)
        │                                                           └─(feedback)─► planner_plan  (LLM modify)
        │
        └─(unknown)────────► router_clarify ──► router
```

---

### Node Reference

#### Router

| Node | Role |
|------|------|
| `router` | Calls `classify()` to determine `"todo"` / `"planner"` / `"unknown"`. If `sessionContext.lastPlanText` is set and the message matches schedule-feedback keywords, overrides a todo intent to planner. Falls back to `sessionContext.activeRoute` for `unknown`. |
| `router_clarify` | **HITL** — asks user to rephrase when intent is unknown. Loops back to `router`. |

#### Todo branch

| Node | Role |
|------|------|
| `todo_understand` | Validates slots via `contract.js`. If a required slot is missing → `pendingAction: clarify`. If the action is destructive (`delete`, `edit`) → `pendingAction: confirm`. Otherwise passes straight through. |
| `todo_clarify` | **HITL** — asks for the missing slot. Resolves task IDs from title descriptions; re-classifies free-text answers for `fields`. Loops back to `todo_understand`. |
| `todo_confirm` | **HITL** — shows a plain-English description of the destructive action. Approve → execute; reject → cancel with a message. |
| `todo_execute` | Runs the store operation: list / read / add / edit / delete. WIRE-sourced tasks are routed to the MCP adapter instead of `task.json`. |

#### Planner branch

| Node | Role |
|------|------|
| `planner_understand` | Determines `subIntent`: `rank`, `plan`, `reorder`, or `complete`. Detects "I finished the plan" phrasing → `complete`. Detects follow-up feedback on an active plan → sets `planFeedback` for `plan` modification. |
| `planner_rank` | Calls `suggestTasks()` (pure scoring: priority + due-date proximity + available minutes + mood). Returns text recommendation, no HITL. |
| `planner_plan` | If `planFeedback + lastPlanText` are both set: calls the LLM with `PLAN_MODIFY_SKILL` to apply the feedback. Otherwise runs `planDay()` (pure scheduling algorithm). Always returns `pendingAction: { type: 'review', planResult }`. |
| `planner_plan_review` | **HITL** — shows the generated schedule. Three outcomes: **approve** → short confirmation message, done; **reject** → clears plan state, loops back for a fresh plan; **any other text** → sets it as `planFeedback`, loops back for LLM modification. |
| `reorder_confirm` | **HITL** — confirms a task move (top / bottom / before / after). Approve runs `store.reorderTask()`. |
| `planner_complete` | **HITL** — when the user says "I finished the plan", builds a diff of status updates (done vs in_progress with logged hours), shows a summary, and applies on approve. |

---

### HITL Mechanism

LangGraph's `interrupt()` suspends graph execution at any node and serialises state to SQLite. The HTTP handler detects `stateValues.__interrupt__[0].value` and returns it as `awaitingInput` to the client.

```
graph.invoke(input, config)
  → throws __interrupt__ signal
  → handler returns { awaitingInput: { kind, question|summary, schedule? } }

// next request
graph.invoke(new Command({ resume: userAnswer }), config)
  → resumes the interrupted node with userAnswer as the return value of interrupt()
```

HTTP status codes:
- `202` — `kind: "clarify"` (needs more information before proceeding)
- `200` — `kind: "approve"` (presenting options for user decision)

---

### Intent Classification

`classify.js` calls the LLM with a fixed system prompt and enforces output shape via JSON schema:

- **Ollama**: `format: <JSON Schema>` (constrained decoding — no markdown drift)
- **Gemini / Gemma**: `responseSchema` (Gemini 2.5) or schema embedded in prompt (Gemma 4, which doesn't support `responseSchema`)

On parse failure the classifier retries once then falls back to `{ intent: "unknown" }`.

**9 intents:** `list` · `read` · `add` · `edit` · `delete` · `reorder` · `suggest` · `plan` · `unknown`

---

## LLM Provider

Configured via `LLM_PROVIDER` in `server/.env`. Switchable at runtime via `POST /api/provider`.

| Provider | Model | Notes |
|----------|-------|-------|
| `ollama` (default) | `gemma4:2b` | Local, constrained decoding via `format`, `think: false`, `num_predict: 256` |
| `gemini` | `gemma4:26b` (or `GEMINI_MODEL`) | Google AI API; Gemma 4 uses prompt-embedded schema + `maxOutputTokens: 512`; thinking parts (`thought: true`) filtered from response |

Provider errors (401, 500) surface as a user-friendly chat message via `LlmProviderError` rather than an HTTP 500.

---

## Frontend

`App.tsx` owns `schedule: Schedule | null` state and passes it down:
- `<Sidebar schedule={schedule} />` — renders the plan timeline
- `<ChatPanel onSchedule={setSchedule} />` — calls `onSchedule` when a plan is confirmed

### Sidebar plan timeline states
| State | Trigger | Display |
|-------|---------|---------|
| Empty | No plan received | Calendar SVG + "No plan yet" |
| Active | Plan approved, current time < plan end | Scrollable timeline; current block highlighted in coral |
| Done | Current time ≥ plan end time | Checkmark SVG + "Day complete!" |

### HITL widgets in chat
| Kind | Widget | Behaviour |
|------|--------|-----------|
| `clarify` | Inline text input | Sends typed answer as resume value |
| `approve` | Approve / Reject buttons | Buttons hidden after either is clicked (checked via user message following the HITL message) |

### `/daily-planner` slash command
Parsed in `index.js` before the graph runs. Accepts `9-17`, `09:00-17:00`, `4h`, or `240m` as arguments. Injects `plannerSlots` directly into graph state, bypassing the LLM classifier entirely.
