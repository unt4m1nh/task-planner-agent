# Planner log template

This is the exact text format `fmtPlannerLog()` (`ingest.js`) builds from an
approved `schedule` and passes to `ingestDocument()` as `content` (with
`source: "planner_log"`, `title: "Daily plan {date}"`). It is not stored as
markdown — this file just documents the shape, with `{placeholders}` for the
parts pulled from the `schedule` object.

```
Daily plan for {date} ({start}-{end}):

{start}-{end} {task.title}
{start}-{end} {task.title} (partial)
{start}-{end} break
{start}-{end} {task.title}

Dropped (did not fit):
- {task.title}
- {task.title}
```

## Field mapping

| placeholder | source | notes |
|---|---|---|
| `{date}` | `schedule.date` | |
| `{start}` / `{end}` (header) | `schedule.start` / `schedule.end` | work-window bounds |
| one line per `schedule.blocks[]` | `block.start`-`block.end` | |
| → `break` | `block.type === 'break'` | literal word "break" |
| → `{task.title}` | `block.task?.title \|\| 'task'` | falls back to literal "task" if missing |
| → `(partial)` suffix | `block.partial` truthy | task didn't fully fit in the remaining window |
| `Dropped (did not fit):` section | `schedule.dropped[]` | only emitted if non-empty; one `- {title}` per dropped task |

## Worked example

Input `schedule`:

```js
{
  date: '2026-06-25',
  start: '09:00', end: '17:00',
  blocks: [
    { start: '09:00', end: '10:30', task: { title: 'Fix login bug' } },
    { start: '10:30', end: '10:45', type: 'break' },
    { start: '10:45', end: '12:00', task: { title: 'Write RAG docs' }, partial: true },
  ],
  dropped: [{ title: 'Refactor auth middleware' }],
}
```

Resulting ingested text:

```
Daily plan for 2026-06-25 (09:00-17:00):

09:00-10:30 Fix login bug
10:30-10:45 break
10:45-12:00 Write RAG docs (partial)

Dropped (did not fit):
- Refactor auth middleware
```

This text is what `searchDocuments()` later retrieves as chunk(s) when a user
asks a question whose intent is classified `ask` (e.g. "what did I do
yesterday afternoon?") — see `RAG_FLOW.md` for the retrieval path.
