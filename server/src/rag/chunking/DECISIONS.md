# `selectStrategy()` decisions

Pure, deterministic, no model call. Conditions evaluated in order, first match wins.

| # | Condition | Strategy | Why |
|---|---|---|---|
| 1 | `sourceType === 'planner_log'` | `no_chunking` | A daily-plan summary is already short and self-contained; splitting fragments a single thought. This is the project's real `documents.source` value for auto-ingested plans — the spec's "planning_log" naming was reconciled to it (see below). |
| 2 | `text.length < shortTextMax` (1000) | `no_chunking` | Nothing to fragment; a blind cut only hurts small inputs. |
| 3 | heading count `H >= minHeadings` (2) | `recursive` | Respect boundaries the author already created; cheaper than `parent_child` and keeps locality between a chunk and its section. |
| 4 | `text.length > longDocMin` (4000) and `H < minHeadings` | `parent_child` | No boundaries to lean on but context still matters — worth the double-storage cost (parent + child rows), and only here. |
| 5 | otherwise | `fixed_size` | Safe baseline when little is known about internal structure. |

`H` = count of lines matching `^#{1,6}\s` (markdown headings), or `metadata.sectionCount` if
the ingester already knows the document's structure.

All three thresholds (`shortTextMax`, `minHeadings`, `longDocMin`) live in `config.js`, not
scattered as magic numbers.

## Naming reconciliation: `planning_log` vs `planner_log`

The plan (`docs/plans/adaptive-chunking.md`) refers to the daily-planner corpus as
`sourceType: "planning_log"`. The real codebase's `documents.source` value (written by
`ingestPlannerLog()` in `ingest.js`) is `"planner_log"`. Per the plan's own header note
("where they disagree, follow the real code"), `selectStrategy()` checks for `"planner_log"`.

## Why `parent_child` children use `fixed_size`, not another `recursive` pass

Children exist purely to be embedded and matched against a query — small, uniform pieces
help vector search precision. Parents already did the structure-aware splitting; re-running
`recursive` on each parent would just rediscover the same boundaries at a smaller scale for
no benefit. `fixed_size` is cheaper and gives predictable, evenly-sized children.
