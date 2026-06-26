# WIRE Transition Map

> Captured from `jira_get_transitions` against a live WIRE issue.
> **Fill in after running P0 manual validation.**

## Status enum → Transition ID

| Our status | WIRE transition name | Transition ID |
|------------|----------------------|---------------|
| `todo` | To Do / Backlog | TODO |
| `in_progress` | In Progress / Start | TODO |
| `done` | Done / Close | TODO |

## Raw transition response

> TODO: paste the full JSON from `jira_get_transitions` on a WIRE issue here.

```json
{}
```

## Notes

- Record any statuses in the WIRE workflow that don't map cleanly to our enum.
- Note which transitions require a specific source status (guards).
