# Chat history — design decisions

Reconciles `docs/plans/chat-history.md` against the real codebase (per the plan's own
header: "where they disagree, the real code wins"). Read alongside the plan.

## Where the plan's assumed primitives didn't exist

The plan assumes a `SessionState` with a `continuation` classification field and a
`PREVIOUS_ACTION` block. None of that existed. What actually exists:

- **`sessionContext`** (`agent/graph/state.mjs`) — a merge-reducer `Annotation` on `AgentState`,
  already durably persisted per `thread_id` by the LangGraph `SqliteSaver` checkpointer
  (`checkpoints.db`). It already tracks `activeRoute`/`activeIntent`/`turnCount` and (for the
  planner) `lastPlanText`/`lastSchedule`/`planRanked`/etc., and already drives a coarse
  follow-up fallback in `routerNode` (`nodes-router.mjs`) when classification returns
  `unknown`. **This is the plan's `SessionState`.** It is not volatile — it survives a restart
  today, because the checkpointer writes synchronously to disk.
- **No `continuation` field, no window of prior turns** — `classify()` (`classify.js`) was
  called with only the latest message; it had zero visibility into the conversation.
- **No human-readable turns log** — conversation history existed only inside the
  checkpointer's serialized graph-state blobs. There was no way to list sessions, see a
  transcript, or query "the last N turns as text" without invoking the graph.

So the actual gap — and what this feature builds — is the **turns store**: a separate,
queryable, human-readable log, plus threading a conversation window into `classify()` so
follow-ups can be recognized from prose, plus one concrete follow-up demo (list-filter
composition). It deliberately does **not** reimplement what `sessionContext` already does.

## `session_id == thread_id` (kept, unchanged)

The plan's locked decision already matches reality: `index.js`'s `/api/chat` handler already
computes `tid = threadId ?? crypto.randomUUID()` and uses it as `thread_id` for the graph's
checkpointer config. The turns store reuses that exact same `tid` as `session_id` — no mapping
table needed.

## Why a new `history.db`, not "the same file" as the plan's §2 step 5 suggests

The plan's pre-flight step assumes one shared `better-sqlite3` file to extend. In reality there
are already **two** separate SQLite files for two separate concerns: `checkpoints.db` (owned
entirely by `@langchain/langgraph-checkpoint-sqlite`'s `SqliteSaver` — its schema is internal
to that package, not meant to be extended with unrelated tables) and `rag.db` (a project-owned
`better-sqlite3` file for the vector store). The turns store follows that **existing
precedent** of "one dedicated SQLite file per concern" rather than the plan's implicit
single-shared-file assumption: a third file, `history.db` (repo root, `better-sqlite3`,
`agent/history/db.mjs`), owned directly by the turns store and never touched by LangGraph
internals. This also keeps the explicit DoD requirement — "not conflated with the
checkpointer" — true at the storage level, not just the API level.

## Schema (`sessions` + `turns` + index) — unchanged from the plan

Implemented exactly as specified in §5: two tables (session lifecycle vs. append-only turn
log), `(session_id, created_at)` index for the sliding-window query, `created_at` as epoch-ms
`INTEGER`, `resolved_context` as small JSON on the assistant turn, `summary` reserved (NULL)
for a future rolling-summary upgrade. No changes — the plan's reasoning held up against the
real schema-inspection step.

## `resolved_context` content — kept deliberately small

Per §5's "ids and a filter, never whole tasks": the assistant turn's `resolved_context` snapshot
is `{ activeRoute, activeIntent, lastListFilter, hasPlan }` — a curated pick off `sessionContext`,
not the whole object. `sessionContext` also carries bulky planner-internal state
(`planRanked`, `planSchedule`, `planDayStructure`, full task arrays) that the checkpointer
already persists for exact graph replay; duplicating that onto every turn row would bloat
`history.db` for no benefit, since the turns store's job is human-readable history and a
*warm-cache rebuild signal*, not a second copy of the checkpointer.

## The `continuation` field and filter composition (the required demo, §8)

Added one optional boolean, `continuation`, to `ollamaSchema` (`classify/schema.js`) — the flat
schema actually enforced via Ollama's constrained decoding (the discriminated `intentSchema`
variants aren't wired to `classify()` at all currently, so they weren't touched). `classify()`
now accepts `{ historyWindow }` and, when present, injects it into the prompt as a
`RECENT CONVERSATION` block with one worked example showing `continuation: true` plus only the
*new* slot. This keeps "minimal model responsibility" (§1): the model recognizes the follow-up
and extracts what's new; it does not need to recall or restate the prior filter.

Code does the binding: `routerNode` reads `ctx.lastListFilter` (a new field on
`sessionContext`, set by `todoExecute`'s `list` case after every list query) and, when
`classified.continuation && ctx.lastListFilter`, merges the new filter fields onto the prior
ones (`mergeListFilter` in `nodes-router.mjs`). Scoped to the `list` intent only — that is
exactly what §8's demo requires; extending continuation merging to other intents was not asked
for and would be scope creep.

## `historyWindow` as graph state, not a parameter threaded by hand

`AgentState` gained one field, `historyWindow` (plain `Annotation()`, last-write-wins, no
custom reducer — same pattern as `route`/`todoSlots`). The orchestrator (`index.js`) fetches
the window from the turns store *before* `graph.invoke()` and puts it on the input — `{
messages, historyWindow }` for a fresh turn, `Command({ resume, update: { historyWindow } })`
for a resume turn (LangGraph's `Command.update` lets a resume also push a state patch, which
matters because `router_clarify`'s resume edge re-enters `router` and therefore calls
`classify()` again). `routerNode` reads `state.historyWindow` and passes it straight through.

## What counts as a "turn" for persistence

Every `/api/chat` call — fresh or resume — maps to exactly one user content + one assistant
content pair:

- Fresh: user content = the new message text.
- Resume: user content = the resume value (`"approve"`/`"reject"`/free text), stringified if
  not already a string.
- Assistant content, when the graph interrupts: the HITL question/summary shown to the user
  (so a clarify/confirm exchange still shows up in the transcript and in future windows —
  otherwise a multi-step HITL conversation would have gaps).
- Assistant content, when the graph completes: `result.response`.

**Guardrail-blocked turns are not persisted** — input-blocked messages return before the graph
even runs, and output-blocked (RAG groundedness) responses return the blocked message instead
of the raw one. Persisting either would either record a message the system refused to act on,
or risk recording raw ungrounded content under the guise of a "turn." Guardrails are an
explicit out-of-scope item in the plan (§0); this is the simplest boundary that doesn't leak
across that line.

## `GET /api/sessions`

Read-only, no HITL gate — matches the project's existing "no HITL on read-only paths" pattern
(e.g. `list`/`read` never confirm). Calls `listSessions()` directly.
