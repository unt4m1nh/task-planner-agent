# Embedding comparison — before vs after Adaptive Chunking

Model: `bge-m3:latest` (Ollama, `/api/embed`), output dim 1024 in all cases.

- **BEFORE** — old `chunk.js`: one rule for everything, blind paragraph-aware cut at ~1200 chars, 150 overlap.
- **AFTER** — `chunking/` router: `selectStrategy()` picks `no_chunking` / `fixed_size` / `recursive` / `parent_child` per document, deterministically, no LLM call.

## Summary

| File | Chars | Source | Before: chunks | Before: avg chars | Strategy chosen | After: chunks (embedded) | After: parents (unembedded) | After: avg chars |
|---|---|---|---|---|---|---|---|---|
| daily-planner.log | 1664 | planner_log | 2 | 831 | no_chunking | 1 | 0 | 1663 |
| embedding-test-results.md | 3790 | upload | 6 | 706 | recursive | 7 | 0 | 540 |
| small-paragraph.txt | 279 | upload | 1 | 279 | no_chunking | 1 | 0 | 279 |
| test.docx | 17967 | upload | 16 | 1108 | parent_child | 55 | 7 | 329 |

## Per-file notes

### daily-planner.log → `no_chunking`
Before: the blind ~1200-char cut split this in the middle of a daily-plan entry (chunk 1 starts mid-log, at "09:14-10:00 Sync WIRE adapter..."), fragmenting a single day's plan across two embeddings.
After: `selectStrategy()` always routes `source = "planner_log"` to `no_chunking` — the whole multi-day log embeds as one unit, each "Daily plan for {date}" entry stays intact for retrieval. No retrieval-relevant change since logs are short either way, but no more arbitrary mid-entry splits.

### embedding-test-results.md → `recursive`
Before: blind 1200-char chunks cut straight through markdown tables/sections (3 chunks landed exactly at the 1200-char boundary regardless of heading position).
After: `recursive` respects heading/paragraph boundaries first — chunk count went from 6 to 7, but each chunk now aligns with a single table/section instead of an arbitrary character offset. Smaller, more semantically coherent pieces (~540 avg vs ~706 avg).

### small-paragraph.txt → `no_chunking`
No difference — both produce a single chunk, since the document is already under any reasonable size threshold (`shortTextMax`). Confirms the router doesn't introduce overhead for trivially small inputs.

### test.docx → `parent_child`
Largest divergence. Before: 16 chunks of ~1100 chars each, blind cuts straight through sentences/fields of the Vietnamese land-registration form. After: 7 coarse **parents** (~2500 chars each, unembedded — kept only for context) + 55 small **children** (~330 chars avg, embedded and searchable). Retrieval now matches on a precise ~330-char fragment but returns the parent's full section as context to the generation step (see `search.js`'s parent-fetch — `searchDocuments()` result `text` is the parent, `matchedText` is the actual matched child). Before, a 1100-char chunk was both the match unit and the context unit, often mixing unrelated fields in one embedding.

## Net effect

- Short/self-contained text (planner logs, small notes): no churn, same single-chunk behavior.
- Structured docs (headings/sections): chunks now align to real document boundaries instead of arbitrary char counts.
- Long, unstructured docs: retrieval precision improves (small child chunks) without losing context (parent fetch on match), at the cost of ~3.4x more rows for `test.docx` (7 parents + 55 children vs 16 flat chunks) — the documented double-storage tradeoff for `parent_child`.
