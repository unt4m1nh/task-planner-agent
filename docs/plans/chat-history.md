# Execution Spec — Persisted Multiturn Chat History

> Read this together with the project's `CLAUDE.md` and the actual source tree.
> This file is the **plan**; `CLAUDE.md` is the **ground truth** for conventions, file names,
> the orchestrator entry point, the `SessionState` shape, the classification schema (incl. the
> `continuation` field), and the canonical `Task` schema. Where they disagree, the real code
> wins — adjust the names below.

---

## 0. Goal & scope

Give the project real, persisted, multiturn memory of a conversation — close to how an actual
chat app behaves: close it, reopen it, the conversation is still there.

**In scope**
- A persistent history store (schema designed here, DB chosen here) backed by `better-sqlite3`.
- Orchestrator accepts or generates a `session_id`, fetches a bounded window of recent turns
  before routing, and persists both the user message and the assistant reply after.
- Listing existing sessions and resuming one — real session lifecycle.
- A context-dependent follow-up ("what about the high-priority ones?") resolving via prior-turn
  context, and surviving an app restart.

**Out of scope (this week)**
- Adaptive chunking, guardrails (separate specs).
- Rolling summary of older turns — a sliding window is enough now; summary is a later upgrade.
- Writing history behind an MCP server — explicitly **not** the design (see §3).

---

## 1. Hard constraints (carry over from `CLAUDE.md`)

- **One owner.** The canonical conversation history has exactly one owner: the **orchestrator**,
  the single component that sees every turn regardless of which agent handles it. The store is
  a dedicated component used **directly** by the orchestrator, never behind an MCP server.
- **Real persistence.** Survives a process restart. No keeping history only in a Node variable
  for the session's lifetime.
- **Stack.** `better-sqlite3` (already a dependency; local-first, no Docker — the obvious fit).
  Put the store module in `.mjs` so the ESM graph nodes and the CommonJS server can both import
  it, matching the existing ESM-isolation pattern.
- **Bounded context.** Inject only a sliding window of the last few turns into any model call,
  never the full log.
- **Minimal model responsibility.** The model must not re-derive references from prose. Give
  deterministic code the structured prior state (intent, resolved task ids / filter) so
  follow-ups bind in code, not by hoping the model re-parses an earlier answer.
- **Backend-first, curl-testable.** Session lifecycle verifiable via curl + direct DB
  inspection (`sqlite3 -box -header`, `litecli`, `~/.sqliterc`). No frontend work here.
- **Config centralised.** Window size, length caps, etc. in one config — no magic numbers.

---

## 2. Pre-flight: confirm against the real system before coding

Record findings in a short note / PR description:

1. **Orchestrator entry.** Find the `/api/chat` handler and where it invokes the graph. This is
   where `session_id` enters, the window is fetched, and turns are persisted.
2. **`SessionState`.** Find its current shape (memory notes it already carries `currentPlan`
   task ids, `lastIntent`, `lastSuggestParams`). This is the **resolved-reference** state for
   follow-ups — do not rebuild a parallel one.
3. **Classification schema.** Find the `continuation` binary field and the `PREVIOUS_ACTION`
   block it gates. The follow-up path reuses these, it does not invent new flags.
4. **Checkpointer.** Find the `MemorySaver` usage (HITL / graph thread state). Note its
   `thread_id` so §3's alignment is concrete.
5. **DB file.** Confirm the `better-sqlite3` database path and how migrations are currently run,
   so the new tables live in the same file and are inspectable with the project's tooling.

If anything contradicts this plan, the real code wins; flag it in the note.

---

## 3. Three layers — do NOT conflate them

This is the single most important design point. There are three distinct state concerns; keep
them separate:

| Layer | Keyed by | Owns | Status |
|---|---|---|---|
| **Turns store** (this spec) | `session_id` | Human-readable conversation: every user msg + assistant reply, in order. The canonical history week-4 requires. | **Build now.** |
| **LangGraph checkpointer** | `thread_id` | Internal graph / HITL state (pending confirmations, node state). | Already on the roadmap (`MemorySaver → SqliteSaver`). Optional this week. |
| **`SessionState`** | per session | Resolved references: `currentPlan` task ids, `lastIntent`, `lastSuggestParams`. Lets "those" / "the high-priority ones" bind to real ids. | Exists already. |

**Alignment decision (locked):** use the **same id** for all three — `session_id == thread_id`.
That keeps the turns store, the checkpointer, and `SessionState` in lockstep without a mapping
table.

**Restart-survival decision (locked):** `SessionState` is volatile (in-memory). To make a
follow-up resolve *after a restart*, do **not** rely on volatile `SessionState` alone — persist
the small structured resolved-context onto the assistant turn row (see §5), so the orchestrator
can rebuild what it needs from the turns store. The turns store stays the single durable source;
`SessionState` becomes a warm cache rebuilt from the latest turn on resume.

The turns store is what satisfies the week-4 DoD. The checkpointer is a separate concern — do
not route conversation history through it, and do not treat its thread state as the canonical
conversation log.

---

## 4. Where the code lives

A dedicated history module (indicative `agent/history.mjs`) exposing a small API, imported
**directly** by the orchestrator. No MCP server, no agent owns it. The orchestrator calls it on
every turn: fetch window before routing, append after the reply is produced.

---

## 5. Data model (graded — design & justify, like the chunking selector)

`better-sqlite3`, two tables. Reasoning goes in a comment block or a short `DECISIONS.md`.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,          -- crypto.randomUUID(), also used as thread_id
  title        TEXT,                       -- derived from first user turn (optional, for listing)
  created_at   INTEGER NOT NULL,           -- epoch ms
  updated_at   INTEGER NOT NULL,           -- epoch ms, bumped on each turn
  summary      TEXT                        -- reserved for future rolling summary; NULL for now
);

CREATE TABLE IF NOT EXISTS turns (
  turn_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id),
  role             TEXT NOT NULL,          -- "user" | "assistant"
  content          TEXT NOT NULL,
  intent           TEXT,                   -- classified intent on user/assistant turns (nullable)
  resolved_context TEXT,                   -- small JSON on ASSISTANT turns: { currentPlan, filter, lastSuggestParams }
  created_at       INTEGER NOT NULL        -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_turns_session_time
  ON turns(session_id, created_at);
```

**Why this shape**
- **Two tables, not one.** Session lifecycle (list / resume / title / updated_at) is separate
  from the append-only turn log. Clean ownership, cheap to list sessions without scanning turns.
- **`(session_id, created_at)` index.** Recovering the *N most recent turns in order* is a
  single `ORDER BY created_at DESC LIMIT N` — this index *is* the sliding window.
- **`created_at` as epoch ms INTEGER.** Unambiguous ordering, sub-second precision (two turns in
  the same second won't tie), and still inspectable. Keep it consistent across both tables.
- **`resolved_context` on the assistant turn.** This is the §3 restart-survival decision made
  concrete: the structured prior state that lets a follow-up bind to real task ids is durable,
  not lost when the process stops. Keep it small — ids and a filter, never whole tasks.
- **`summary` reserved.** Column exists now so the future rolling-summary upgrade needs no
  migration; left NULL this week.

---

## 6. History store API

Pure data access, deterministic, no model calls. Indicative signatures:

```ts
createSession(title?: string): string                 // returns new session_id
getOrCreateSession(session_id?: string): string       // resume if given+exists, else create
addTurn(session_id, role, content, opts?: {            // append; bumps sessions.updated_at
  intent?, resolved_context?
}): void
getRecentTurns(session_id, n: number): Turn[]          // last n, returned in CHRONOLOGICAL order
listSessions(): SessionSummary[]                       // session_id, title, updated_at, turn count
getSessionResolvedContext(session_id): ResolvedContext | null  // from latest assistant turn
```

Notes:
- `getRecentTurns` queries `ORDER BY created_at DESC LIMIT n` then **reverses** to chronological
  before returning — the prompt needs oldest→newest.
- `addTurn` and the `updated_at` bump happen in a single transaction (`better-sqlite3` is
  synchronous; wrap in a transaction for atomicity).
- `getSessionResolvedContext` reads `resolved_context` off the most recent assistant turn — the
  warm-cache rebuild path after a restart.

---

## 7. Orchestrator integration

Per turn:

```
request → { user_message, session_id? }
   │
   ▼
 session_id = getOrCreateSession(session_id?)
   │
   ▼
 window = getRecentTurns(session_id, WINDOW_SIZE)      # bounded sliding window
   │
   ▼
 (rebuild SessionState warm cache from getSessionResolvedContext if empty)
   │
   ▼
 classify( user_message, window )   # window injected as bounded context
   │
   ▼
 route → agent(s) → reply
   │
   ▼
 addTurn(session_id, "user", user_message, { intent })
 addTurn(session_id, "assistant", reply, { intent, resolved_context })
   │
   ▼
 response → { reply, session_id }                      # return session_id so FE can resume
```

**Request shape shift (call this out).** With a durable server-side history, the canonical
context lives in the store, not in the client. The request should carry the **new user message +
optional `session_id`**, and the server reconstructs context from the window. Sending the full
`messages` array from the FE becomes redundant and is a worse source of truth — prefer
server-side history. Reconcile the exact request/response shape with `CLAUDE.md`.

`WINDOW_SIZE` lives in config (start ~6–10 turns).

---

## 8. Follow-up resolution (the required demo)

"What about the high-priority ones?" only makes sense given the previous turn. It needs **both**:

1. **The raw window** (last N turns as text) — gives the model enough to classify the follow-up
   and set `continuation = true`.
2. **The structured resolved-context** — `currentPlan` ids / `filter` / `lastSuggestParams` from
   the previous assistant turn (via `getSessionResolvedContext`, persisted per §5). Deterministic
   code re-applies the prior intent/filter to the **real task ids**; the model does not re-derive
   them from prose.

Flow: classify sees the window → sets `continuation = true` and the new filter (`priority=high`)
→ code honors the `PREVIOUS_ACTION` block, takes the prior `currentPlan`, applies the new filter
in code → answers. This keeps to minimal model responsibility: the model recognises the
follow-up; the code resolves the references.

Because `resolved_context` is persisted on the turn, this still works **after a restart** — the
warm cache is rebuilt from the store, not from a lost in-memory `SessionState`.

---

## 9. Session lifecycle (list / resume)

Real lifecycle, not one hardcoded conversation. These are read-only paths → **no HITL gate**
(per the project's "no HITL on read-only paths" rule).

- **List:** `listSessions()` exposed via a minimal read endpoint (indicative `GET /api/sessions`)
  → id, title, updated_at, turn count.
- **Resume:** pass an existing `session_id` to `/api/chat`; `getOrCreateSession` resumes it and
  the window/resolved-context come back automatically.
- **New:** omit `session_id`; a fresh one is generated and returned.

Reconcile endpoint names/shape with `CLAUDE.md` — the original chat-only design may need one
small read endpoint added for listing; keep it minimal and curl-testable.

---

## 10. Phased implementation (backend-first, each phase verifiable)

- **P0 — Migration.** `sessions` + `turns` + index in the existing DB file. Verify with
  `.schema`.
- **P1 — Store module.** §6 API + unit tests (create, append, recent-in-order, list, resolved
  context). No orchestrator changes yet.
- **P2 — Orchestrator wiring.** Accept/generate `session_id`, fetch window, persist both turns,
  return `session_id`. A single-turn conversation now persists.
- **P3 — Follow-up resolution.** Inject window into classify; persist `resolved_context`; honor
  `continuation` + `PREVIOUS_ACTION` to bind references in code (§8).
- **P4 — Lifecycle.** List + resume (§9).
- **P5 — Restart + multi-session demos.** §11 tests, including direct DB inspection after a
  restart.

Each phase: unit tests, then curl on `/api/chat` to confirm turns persist, then
`sqlite3 -box -header` to confirm rows landed correctly.

---

## 11. Test plan

**Unit (deterministic, no model)**
- `addTurn` then `getRecentTurns` returns chronological order.
- `getRecentTurns(_, N)` on a session with > N turns returns exactly the last N.
- Two sessions: turns never leak across `session_id`.
- `getSessionResolvedContext` reads the latest assistant turn's JSON.

**Integration (curl on `/api/chat`)**
- First call with no `session_id` → response includes a generated `session_id`; a `sessions` row
  and two `turns` rows exist.
- Resume with that `session_id` → window includes the earlier turns.

**Follow-up resolution (DoD)**
- Turn 1 (VN): `"Công việc hôm nay của tôi là gì?"` → list answer.
- Turn 2 (VN): `"Thế còn mấy cái priority cao thì sao?"` → assert it filters the **same** set
  from Turn 1 to high priority, via window + `resolved_context` + `continuation=true`.

**Restart survival (DoD — inspect storage directly)**
- Run Turn 1 + Turn 2 in a session, **kill the process**, restart, then:
  ```bash
  sqlite3 -box -header <db> \
    "SELECT turn_id, role, intent, substr(content,1,40), created_at
     FROM turns WHERE session_id='<id>' ORDER BY created_at;"
  ```
  → turns are intact. Then send the follow-up Turn 3 → it still resolves (proves
  `resolved_context` survived, not just the text).

**Bounded window (DoD)**
- Create > `WINDOW_SIZE` turns; confirm via the LangSmith trace / prompt that only the last
  `WINDOW_SIZE` turns were injected, not the full log.

---

## 12. Definition of done (maps to the week-4 checklist)

- [ ] A `session_id` persists correctly across multiple turns in one conversation.
- [ ] A context-dependent follow-up is answered correctly using prior-turn context.
- [ ] History injected into each call is bounded (sliding window), not the full log.
- [ ] The conversation survives an app restart — proven by inspecting the persisted SQLite
      directly, not just by staying within one running process.
- [ ] Multiple sessions are supported: start new, list, resume; no cross-session leakage.
- [ ] Schema design and DB choice are documented with reasoning (the `DECISIONS.md` note).
- [ ] The turns store is owned by the orchestrator and used directly — not behind an MCP server,
      and not conflated with the checkpointer or `SessionState`.
- [ ] Window size and caps live in config; no magic numbers.