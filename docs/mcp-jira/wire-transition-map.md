# WIRE Transition Map

> Captured from `jira_get_transitions` against a live WIRE issue.
> **Fill in after running P0 manual validation.**

## Status enum → Transition ID

Captured from `jira_get_transitions` on project `DP05210911` (LG Ecommerce).
Transition IDs are project-specific — verify for other projects before using.

| Our status | WIRE transition name | Transition ID |
|------------|----------------------|---------------|
| `in_progress` | Start Dev | 11 |
| `done` | Finish Dev | 31 |

> `todo` (Open) is the default state on creation — no transition needed.

## Raw transition response

```json
[
  { "id": 11, "name": "Start Dev" },
  { "id": 31, "name": "Finish Dev" }
]
```

## Notes

- Transition IDs differ per project. Always call `jira_get_transitions` on a real issue before hardcoding IDs.
- `Open` → `Start Dev` (11) → `Finish Dev` (31) is the only workflow observed on `DP05210911`.
- No guard was encountered for back-transitions in this project.
