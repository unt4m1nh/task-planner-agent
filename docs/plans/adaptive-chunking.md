# Execution Spec — Adaptive Chunking for the RAG Layer

> Read this together with the project's `CLAUDE.md` and the actual source tree.
> This file is the **plan**; `CLAUDE.md` is the **ground truth** for conventions, file
> names, and the existing schema. Where they disagree, follow the real code and adjust
> the names below — do not blindly create new files if equivalents already exist.

---

## 0. Goal & scope

Replace the single hardcoded chunk rule (the blind ~500-char cut) with a small library of
named strategies, selected **deterministically by code** based on what kind of data is
being ingested.

**In scope**
- Four strategies behind one interface: `no_chunking`, `fixed_size`, `recursive`, `parent_child`.
- A pure-code `selectStrategy()` router with documented conditions.
- Ingestion path (planning-log hook + document ingest) calls the router instead of a constant.
- Retrieval path teaches the `parent_child` case to return parent context.
- A small comparison script to see the difference between strategies.

**Out of scope (do not touch this week)**
- Guardrails, chat history (separate specs).
- Changing the embedding model (stays BGE-M3) or the vector engine (stays `sqlite-vec` +
  `better-sqlite3`).
- Re-ranking, hybrid search, or any retrieval-quality work beyond wiring parent fetch.

---

## 1. Hard constraints (carry over from `CLAUDE.md`)

- **Minimal model responsibility.** `selectStrategy()` and every chunker are deterministic
  code. **No LLM call anywhere in this feature.** Same input → same output, always.
- **Stack.** Node/TypeScript, `better-sqlite3`, `sqlite-vec`, BGE-M3. ESM RAG modules live
  in `.mjs` and are loaded via dynamic `import()` from the CommonJS server (match the
  existing pattern; do not invent a new loading scheme).
- **No new infrastructure.** No Docker, no new service. Everything runs in WSL2 against the
  existing SQLite file.
- **Schema discipline.** Before writing a migration, inspect the *actual* chunks table and
  `sqlite-vec` virtual table. Reuse existing column names; do not duplicate columns under a
  new name.
- **Backend-first, curl-testable.** Every phase is verifiable via curl on `/api/chat` and/or
  direct DB inspection (`sqlite3 -box -header`, `litecli`). No frontend work in this spec.
- **Config centralised.** All thresholds and sizes live in one config object/module
  (e.g. `chunking.config`), never as magic numbers scattered in the chunkers.

---

## 2. Pre-flight: confirm against the real system before coding

Do these reads first and record findings in the PR description / a short note:

1. Open the document-ingestion entry point and the planning-log ingestion hook. Find the
   exact place the current ~500-char cut happens. This is the **only** call site that must
   change to use the router.
2. Inspect the chunks table and the `sqlite-vec` table:
   ```bash
   sqlite3 -box -header <db> ".schema"      # all tables incl. vec virtual table
   sqlite3 -box -header <db> "SELECT * FROM <chunks_table> LIMIT 3;"
   ```
   Note: which column holds chunk text, how a chunk links to its source document, and how
   the embedding row is keyed to the chunk row.
3. Confirm the two corpora behave as documented: planning-log entries embed only the
   free-text `summary`; uploaded documents go through full vector RAG. The planning-log path
   is *already effectively no-chunking* — confirm this so the migration for it is a no-op or
   a trivial relabel.

If anything below contradicts what you find, the real code wins. Flag the contradiction in
the note rather than silently diverging.

---

## 3. Data model changes

Add to the existing chunks table (names indicative — reconcile with §2):

| Column      | Type            | Meaning |
|-------------|-----------------|---------|
| `strategy`  | TEXT NOT NULL   | Which strategy produced the row (`no_chunking` \| `fixed_size` \| `recursive` \| `parent_child`). |
| `parent_id` | INTEGER NULL    | Self-referential FK to the parent chunk row. NULL for every strategy except `parent_child` children. |
| `is_parent` | INTEGER DEFAULT 0 | 1 for parent rows that exist only to provide context and are **not** embedded/retrieved as children. |

**Storage model for `parent_child` (this is the documented double-storage cost):**
- Parent pieces are inserted as rows with `is_parent = 1`, **not** embedded into the vec table.
- Child pieces are inserted as normal embedded rows with `parent_id` pointing at their parent
  and `is_parent = 0`.
- Only children appear in the vector index. Parents are fetched by id at generation time.

This keeps parent text stored **once** (normalised via FK), not duplicated onto every child.
Do not denormalise parent text onto child rows.

Write a forward-only migration. If the table already has data from the old cut, default
existing rows to `strategy = 'fixed_size'`, `parent_id = NULL`, `is_parent = 0` so nothing
breaks, then handle re-ingest in §8.

---

## 4. The strategy interface

One interface so strategies are swappable. Indicative TypeScript — match project style:

```ts
export interface ChunkInput {
  text: string;
  sourceType: string;                 // e.g. "planning_log" | "document"
  metadata: Record<string, unknown>;  // filename, mime, sectionCount, etc.
}

export interface ProducedChunk {
  text: string;            // the CHILD text that gets embedded
  isParent?: boolean;      // true only for parent rows (parent_child)
  parentLocalId?: number;  // links a child to its parent within this batch, pre-DB-insert
  charStart?: number;      // for debugging / the comparison script
  charEnd?: number;
}

export interface ChunkStrategy {
  readonly name: "no_chunking" | "fixed_size" | "recursive" | "parent_child";
  chunk(input: ChunkInput): ProducedChunk[];
}
```

The ingestion writer is responsible for turning `parentLocalId` links into real `parent_id`
FKs after inserting parent rows first. Keep that linking logic in the writer, not in the
chunkers, so each chunker stays a pure `text -> chunks` function.

---

## 5. The four strategies

Implement each as a pure function behind the interface. Unit-test each in isolation.

### 5.1 `no_chunking`
Return the whole input as a single chunk. No splitting.
- Use for: short, self-contained text (planning-log summaries are the canonical case).
- Test: any input → exactly one chunk whose text equals the input.

### 5.2 `fixed_size` (with overlap, sentence-aware)
Split into chunks of a target size, **never cutting mid-sentence**, with a small overlap so an
idea spanning a boundary survives on both sides.

Algorithm:
1. Segment text into sentences (a pragmatic regex on `.?!` + newline is acceptable; document
   the limitation).
2. Greedily accumulate sentences until adding the next would exceed `targetSize`; emit a chunk.
3. Start the next chunk by carrying back the trailing sentences that fit within `overlapSize`.
4. Edge case: a single sentence longer than `targetSize` → hard-split that sentence as a last
   resort (this is the only place a mid-sentence cut is allowed).

Config: `targetSize` (default ~500 chars), `overlapSize` (default ~10–15% of target).

Tests: no chunk exceeds `targetSize` except the hard-split case; consecutive chunks share the
expected overlap; no chunk is empty.

### 5.3 `recursive` (structure-aware)
Try the largest natural boundary first, fall back only when a piece is still too big.

Separator hierarchy (markdown-friendly, since the corpus includes `.md`):
```
headings ("\n#"… "\n######")  →  blank-line paragraphs ("\n\n")  →  lines ("\n")  →  sentences  →  fixed_size hard-split
```
For each piece produced at one level, if it still exceeds `maxSize`, recurse into the next
separator. Reuse `fixed_size` as the terminal fallback.

- Use for: documents that already have visible structure (headings, distinct paragraphs).
- You may use `@langchain/textsplitters` `RecursiveCharacterTextSplitter` if LangChain is
  already a dependency, **but** the selector still owns the decision and you must document the
  separator list either way. A thin own implementation is preferred for transparency since
  this is graded on understanding.

Tests: a doc with headings produces chunks aligned to heading/paragraph boundaries (no chunk
straddles two headings unless it was already under `maxSize`).

### 5.4 `parent_child` (hierarchical)
Chunk twice: small children for matching, large parents for context.

1. Produce **parents** with `recursive` at a coarse `maxSize` (a section/page-sized unit).
2. For each parent, produce **children** with `fixed_size` at a smaller size.
3. Emit parents (`isParent: true`) and children (with `parentLocalId` set).

Retrieval contract (see §7): match on children, generate on the parent's full text.

- Use for: long, dense documents with little usable structure, where a matched chunk needs the
  surrounding context it can't get from its own text.
- Tests: every child has a resolvable parent; parents are flagged `isParent`; child sizes ≤
  parent sizes.

---

## 6. The selector — `selectStrategy()` (graded; document the reasoning)

```ts
function selectStrategy(sourceType: string, text: string, metadata: Meta): StrategyName
```

Pure, deterministic, **no model call**. Conditions below are the proposed design — keep them
in a comment block or a short `DECISIONS.md` next to the code, with the reasoning, because an
inconsistent or unjustified selector is a real deduction.

Evaluate in this order (first match wins):

1. `sourceType === "planning_log"` → **`no_chunking`**.
   *Given. A summary is already short and self-contained; splitting fragments a single thought.*
2. `text.length < SHORT_TEXT_MAX` (default ~1000) → **`no_chunking`**.
   *Nothing to fragment; a blind cut only hurts.*
3. structured document: heading count `H ≥ MIN_HEADINGS` (default 2) → **`recursive`**.
   *Respect boundaries the author already created; cheaper than parent_child and keeps locality.*
4. long & dense: `text.length > LONG_DOC_MIN` (default ~4000) **and** `H < MIN_HEADINGS`
   → **`parent_child`**.
   *No boundaries to lean on but context matters — worth the double-storage cost here, and only here.*
5. otherwise → **`fixed_size`**.
   *Safe baseline when little is known about internal structure.*

Where `H` = count of lines matching `^#{1,6}\s` (markdown). For non-markdown, approximate
structure with blank-line paragraph count or `metadata.sectionCount` if the ingester provides
it. All of `SHORT_TEXT_MAX`, `MIN_HEADINGS`, `LONG_DOC_MIN` live in the chunking config.

Tests (deterministic — assert exact strategy name):
- `planning_log` (any length) → `no_chunking`.
- 200-char doc → `no_chunking`.
- markdown with 3 headings → `recursive`.
- 6000-char doc, 0 headings → `parent_child`.
- 2000-char doc, 0 headings → `fixed_size`.
- Same input twice → identical output (determinism).

---

## 7. Ingestion & retrieval integration

**Ingestion** (the one call site from §2):
```
text, sourceType, metadata
   → selectStrategy(...)               # pure code
   → strategy.chunk(...)               # produces children (+ parents for parent_child)
   → insert parent rows first (is_parent=1, no embedding)
   → embed each child (BGE-M3) → insert child rows (parent_id set) → vec index
```
Replace the hardcoded cut with this. Stamp every row's `strategy` column.

**Retrieval** (only the `parent_child` case changes):
- Vector search returns child rows (parents are not in the index).
- For each matched child with a non-NULL `parent_id`, fetch the parent row's text and pass the
  **parent** text to generation; for all other strategies pass the matched chunk's own text.
- Keep this branch small and localised; do not change ranking or scoring.

---

## 8. Re-ingesting existing data

The DoD requires existing data to be re-processed under the new routing **or** a written
justification for why not.

- Planning-log corpus: already effectively `no_chunking`; re-labelling `strategy` is enough —
  no re-embed needed. State this explicitly as the justification.
- Document corpus: provide a small re-ingest command that clears document chunks (and their
  vec rows) and re-ingests through the router. Make it idempotent and scoped to the document
  corpus only (never wipe planning logs). Confirm row counts before/after with
  `sqlite3 -box -header`.

---

## 9. Comparison script (DoD: must show a concrete difference)

Not a full eval suite — just enough to *see* the difference.

- Pick one sample document where the answer spans a paragraph/section boundary (this is where
  strategies diverge most).
- Ingest the same doc under two strategies into a **throwaway namespace** (a temp source id or
  a temp DB file — never pollute the real corpus).
- Run the same handful of test questions against each.
- Print the retrieved chunks side by side (and, if cheap, the final answers).
- Expected, demonstrable difference: `fixed_size` returns a fragment missing surrounding
  context; `recursive`/`parent_child` returns a coherent, boundary-respecting block.

Make the script runnable standalone (`node scripts/compare-chunking.mjs <doc>`), printing to
stdout so the difference is readable without a UI.

---

## 10. Phased implementation (backend-first, each phase verifiable)

- **P0 — Migration.** Add `strategy`, `parent_id`, `is_parent`; default existing rows. Verify
  with `.schema`.
- **P1 — Interface + `no_chunking` + `fixed_size`.** Pure functions + unit tests.
- **P2 — `recursive`.** Separator hierarchy + tests on a structured doc.
- **P3 — `parent_child` + retrieval parent-fetch.** Storage with `parent_id`; retrieval branch + tests.
- **P4 — `selectStrategy()`.** Router + deterministic unit tests (§6).
- **P5 — Wire into ingestion.** Replace the cut at the real call site; planning-log + document paths.
- **P6 — Re-ingest + comparison script.** §8 and §9; capture before/after output.

Each phase: run unit tests, then a curl against `/api/chat` to confirm RAG queries still work,
then inspect the DB to confirm rows carry the expected `strategy`/`parent_id`.

---

## 11. Test plan

**Unit (deterministic, no DB, no model)**
- Each strategy's invariants (§5).
- `selectStrategy()` truth table (§6), including the determinism check.

**Integration (DB + embeddings)**
- Ingest a planning-log entry → exactly one `no_chunking` row, embedded summary only.
- Ingest a structured markdown doc → `recursive` rows aligned to boundaries.
- Ingest a long dense doc → parent rows (`is_parent=1`, unembedded) + child rows
  (`parent_id` set, embedded); confirm vec index contains children only.

**Retrieval (curl on `/api/chat`)**
- A document query that previously returned a context-poor fragment now returns parent context
  under `parent_child`. Show the before/after.

**DB inspection (the project's preferred tooling)**
```bash
sqlite3 -box -header <db> \
  "SELECT id, strategy, is_parent, parent_id, substr(text,1,40) FROM <chunks> ORDER BY id LIMIT 20;"
# verify children point at parents; parents are unembedded
```

---

## 12. Definition of done (maps to the week-4 checklist)

- [ ] All four strategies implemented behind one interface.
- [ ] `selectStrategy()` routes the given `planning_log → no_chunking` case correctly, and its
      conditions for the other three are written down **with reasoning**.
- [ ] Ingestion calls the router instead of a hardcoded size, at the real call site.
- [ ] `parent_child` stores parents once via `parent_id`; retrieval returns parent context.
- [ ] Comparison script shows a concrete difference between two strategies on one sample doc.
- [ ] Existing data re-processed under the new routing, or a written justification (planning
      logs) for why re-embedding wasn't needed.
- [ ] All units in the chunking config are explicit; no magic numbers in the chunkers.
- [ ] No LLM call introduced anywhere in this feature.