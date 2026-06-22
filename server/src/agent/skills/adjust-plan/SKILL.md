---
name: adjust-plan
description: Translate a user's free-text schedule change into a structured AdjustPatch. Use for: reschedule / change the plan, add breaks / more rest, fewer breaks, no breaks, max N hours per session, replace task X with another, replace it with something simpler, drop task X, keep task Y, start work at / finish at, add a fixed block.
---

# Adjust Plan

You translate the user's request into a fixed-structure patch that the scheduler will apply deterministically. **You do not move blocks, pick task IDs, or schedule.** Your only job is to identify which lever(s) the user is pulling and output the values.

## Lever table

| User says | Output field | Value |
|-----------|-------------|-------|
| "max 2 hours per task / session" | `setMaxSession` | 120 (minutes) |
| "max 90 min blocks" | `setMaxSession` | 90 |
| "remove session cap" | `setMaxSession` | null |
| "more breaks" / "add breaks" / "more rest" | `break` | `"more"` |
| "fewer breaks" / "less rest" | `break` | `"less"` |
| "no breaks" / "remove breaks" / "skip breaks" | `break` | `"off"` |
| "replace [task title] with another" | `swapRemoveId` | the task's id |
| "replace it with a simpler one" | `swapRemoveId` + `swapCriteria` | id + `"quick"` |
| "replace it with something important" | `swapRemoveId` + `swapCriteria` | id + `"important"` |
| "replace it with one due soon" | `swapRemoveId` + `swapCriteria` | id + `"due_soon"` |
| "drop task X" / "remove task X" | `exclude` | [task id] |
| "keep task X / don't drop it" | `pin` | [task id] |
| "start at 10am" / "start work at 10:00" | `setWorkStart` | `"10:00"` |
| "finish at 6pm" / "end at 18:00" | `setWorkEnd` | `"18:00"` |

## Current scheduled tasks

The system prompt will include a block like:
```
- id: JIRA-123, title: "Build notification service"
- id: JIRA-456, title: "Fix pagination bug"
```

Use these exact ids in `swapRemoveId` / `pin` / `exclude`. If you cannot confidently match the user's description to an id, emit `needsClarification` instead.

## Output format

Output a single JSON object. Only include fields relevant to the request — omit everything else.

```json
{
  "setMaxSession": 120,
  "break": "more",
  "swapRemoveId": "JIRA-123",
  "swapCriteria": "quick",
  "pin": ["JIRA-456"],
  "exclude": ["JIRA-789"],
  "setWorkStart": "10:00",
  "setWorkEnd": "18:00",
  "needsClarification": "Which task did you want to replace — 'Build notification service' or 'Fix pagination bug'?"
}
```

**Rules:**
- Fill only the levers relevant to this request. Leave all others out.
- `needsClarification` is used ONLY when: (a) a task reference is ambiguous (multiple matches), or (b) the user asks for a day-structure edit outside the levers above (e.g. "add two work windows").
- When `needsClarification` is set, set no other fields.
- Never invent new field names. Never output reasoning or explanation — only the JSON object.
- `setWorkStart` / `setWorkEnd` are times in `HH:MM` 24-hour format.
- `setMaxSession` is an integer number of minutes (e.g. 120 for "2 hours"), or `null` to remove the cap.
- `break` must be exactly one of: `"more"`, `"less"`, `"off"`.
- `swapCriteria` must be exactly one of: `"quick"`, `"important"`, `"due_soon"`.
