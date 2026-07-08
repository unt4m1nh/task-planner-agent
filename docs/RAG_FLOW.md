# RAG Flow

Retrieval-augmented generation over two kinds of content: user-uploaded
documents and auto-ingested daily-planner logs. Storage is a separate SQLite
file (`rag.db`, repo root, gitignored) with the `sqlite-vec` extension for
vector search — independent of `task.json` and `checkpoints.db`.

## Storage (`rag.db`)

| table | purpose |
|---|---|
| `documents` | one row per ingested doc: `source`, `title`, `content`, `created_at` |
| `chunks` | paragraph-aware text chunks per document: `document_id`, `chunk_index`, `text`, `source_type` |
| `vec_chunks` | `vec0` virtual table — one 1024-dim float embedding per chunk, `rowid` = `chunks.id` |
| `vec_chunks_*` | internal bookkeeping tables auto-created by `sqlite-vec` to back `vec_chunks`; never queried directly |

Opened/created in `db.js` (`getDb()`), which loads the `sqlite-vec` extension
into `better-sqlite3` and runs `CREATE TABLE IF NOT EXISTS` for all of the
above. `EMBED_DIM` (default 1024) must match the embedding model's output
size or the `vec0` insert fails.

`chunks.source_type` is a denormalized copy of the parent `documents.source`
(`"upload"` or `"planner_log"`), written at insert time so chunk-level
filtering/grouping doesn't require a join back to `documents`. `getDb()`
auto-migrates older `rag.db` files that predate this column: it adds it via
`ALTER TABLE` if missing, then backfills every row from `documents.source`.

## Ingestion path

```
ingestDocument({ source, title, content })   (ingest.js)
  → chunkText(content)                        chunk.js — paragraph-aware, ~1200 chars, 150 overlap
  → embed(chunks)                             embeddings.js — Ollama bge-m3, /api/embed, batched
  → one SQLite transaction:
      INSERT INTO documents
      INSERT INTO chunks        (per chunk, source_type = the document's source)
      INSERT INTO vec_chunks    (per chunk, rowid = chunks.id as BigInt)
```

Two entry points call `ingestDocument`:

1. **`POST /api/rag/documents`** — `{ title, content, source? }`, source defaults to `"upload"`.
2. **`POST /api/rag/upload`** — multipart file upload (`.pdf`/`.docx`/text via
   `extract.js`), title defaults to the filename, source is always `"upload"`.
3. **`ingestPlannerLog(schedule)`** — auto-fires from `planner_plan_review`
   (`nodes-planner.mjs`) whenever a daily plan is approved. Formats the
   schedule's blocks/breaks/dropped tasks into plain text and ingests it with
   `source: "planner_log"`. Fire-and-forget — errors are logged, not thrown.

## Search

`searchDocuments(query, { topK = 5, source })` (`search.js`):
1. Embeds the query (same `bge-m3` model).
2. `vec0` KNN: `SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k = ?` (over-fetches `topK * 4` to leave room for source filtering).
3. Joins each `rowid` back to `chunks`/`documents` for the text, title, source.
4. Optionally filters by `source`, then truncates to `topK`.

Each result includes `sourceType` (from `chunks.source_type`) alongside
`source` (from `documents.source`) — the two are always equal today, since
`source_type` is just denormalized off `documents.source` at ingest time.

Exposed directly via **`POST /api/rag/search`** — `{ query, topK?, source? }`.

## Agentic RAG (`ask` intent)

A "self-correcting" retrieval loop, ported from the LangGraph agentic-RAG
tutorial onto this project's small-model, schema-enforced LLM pattern
(`agentic.js`, wired into the graph by `nodes-rag.mjs`):

```
router (classifies "ask")
  → rag_retrieve   searchDocuments(query, topK=3)
  → rag_grade      LLM: are these docs relevant? (binary_score yes/no)
       relevant OR attempts >= MAX_REWRITES (2) → rag_generate
       else                                     → rag_rewrite → rag_retrieve (loop)
  → rag_generate   LLM answers using ONLY retrieved context (+ current tasks),
                   must cite sources by [n], critiques gaps/contradictions
                   instead of restating data at face value
  → END
```

- `rag_grade` and `rag_rewrite` fail open: if the LLM call errors, grading
  defaults to "relevant" and rewriting falls back to the original query —
  retrieval never hard-fails because of a flaky classification step.
- `rag_generate`'s schema forces the model to restate the question and write
  `reasoning` before producing `answer.dataRetrieved` — only `dataRetrieved`
  is returned to the user; `question`/`reasoning` are scaffolding that keeps
  a small model honest, not user-facing output.
- Each step is its own graph node (rather than one function) so the
  retrieve/grade/rewrite loop is visible in LangGraph Studio traces.

## Known gaps

- Nothing currently injects RAG search results into the `todo`/`planner`
  chat prompts — only the `ask` intent's agentic loop consumes retrieval.
- `vec_chunks_*` bookkeeping tables are an implementation detail of
  `sqlite-vec`; don't hand-edit them.
