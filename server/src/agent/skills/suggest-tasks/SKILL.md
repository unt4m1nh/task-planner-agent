---
name: suggest-tasks
description: Score and recommend which tasks the user should work on, based on their mood, working preference, and available time. Use this whenever the classifier returns intent=suggest, or whenever the user asks what to do next, asks for quick/short tasks, says they are tired or low-energy, says they feel energetic, asks which task is most important, or asks what is due soon — even if they don't use the word "suggest".
---

# Suggest Tasks

Pick the best 1–3 tasks for the user to work on right now. Score all non-done tasks together — overdue tasks compete in the same pool. After the suggestion, append a short reminder about any overdue items.

This skill assumes `intent` has already been classified as `suggest`. Your job is to read the extracted slots, score the candidate tasks, and produce a reply.

## Slots the model extracts

Extract exactly these three slots from the user's message. `mood` and `preference` are **independent** — a single sentence can set both.

```json
{
  "mood": "tired | energetic | neutral",
  "preference": "quick | important | due_soon | null",
  "availableMinutes": "number | null"
}
```

Rules:
- Default `mood` to `neutral` when no mood is expressed.
- Default `preference` to `null` when no working preference is expressed.
- Default `availableMinutes` to `null` when no time budget is mentioned.
- "I'm tired but give me something important" → `mood=tired`, `preference=important`.
- "Feeling great, give me something quick" → `mood=energetic`, `preference=quick`.

## Task fields used for scoring

Read only these fields from each task object. Ignore everything else.

```json
{
  "id": "string",
  "title": "string",
  "status": "todo | in_progress | done",
  "priority": "high | medium | low",
  "due_date": "ISO timestamp | null",
  "estimate_hours": "number | null",
  "logged_hours": "number | null"
}
```

## Step 1 — Prepare each task

```text
isDone     = status == "done"                         # if true, DROP the task

remainHours = estimate_hours != null
                ? max(0, estimate_hours - (logged_hours ?? 0))
                : null
remainMin   = remainHours != null ? remainHours * 60 : null

dueDate     = due_date != null ? date part of due_date : null
isOverdue   = dueDate != null AND dueDate < today
isDueToday  = dueDate != null AND dueDate == today
```

## Step 2 — Score every non-done task (overdue included)

```text
priorityScore = { high: 30, medium: 20, low: 10 }[priority]

# 1. base
score = priorityScore

# 2. due date
if isDueToday:                          score += 25
if isOverdue:                           score += 35

# 3. preference
if preference == "quick":
    if remainMin == null:               DROP the task     # can't prove it's quick
    elif remainMin <= 30:               score += 25
    elif remainMin <= 60:               score += 10
    else:                               score -= 10
if preference == "important":           score += priorityScore   # doubles priority
if preference == "due_soon":
    if dueDate is within <= 2 days:     score += 20

# 4. mood
if mood == "tired":
    if remainMin == null:               score += 0        # neutral, not penalized
    elif remainMin <= 30:               score += 15
    else:                               score -= 10
if mood == "energetic":                 score += priorityScore   # doubles priority

# 5. momentum
if status == "in_progress":             score += 10
```

Sort by `score` descending, keep the **top 3**. On ties, preserve store order (stable sort).

## Step 3 — Reply format

Output the suggestion first, then a separate overdue reminder if any overdue tasks exist.

**Suggestion block:**
```
Work on:
• {title} (~{remainMin}m, {priority})
• {title} ({priority})
```

- If `remainMin == null`, omit the `~{remainMin}m` part.
- Always include `priority`.

**Overdue reminder (append after suggestion, only when overdue tasks exist):**
```
⚠️ Reminder: {n} task(s) overdue — {title} ({d}d late), {title} ({d}d late)
```

- List all overdue tasks by name with how many days late.
- Keep it on one line at the end, not as a heading.

**Nothing to do:**
```
Nothing left to do today 🎉
```

## Examples

Assume `today = 2026-06-10` and this store:

```json
[
  { "id": "t1", "title": "Đấm Thao", "status": "in_progress", "priority": "medium",
    "due_date": null, "estimate_hours": null, "logged_hours": null },
  { "id": "t2", "title": "Write report", "status": "todo", "priority": "high",
    "due_date": "2026-06-10T09:00:00Z", "estimate_hours": 0.5, "logged_hours": 0 },
  { "id": "t3", "title": "Clear inbox", "status": "todo", "priority": "low",
    "due_date": "2026-06-07T00:00:00Z", "estimate_hours": 0.25, "logged_hours": 0 }
]
```

**Example 1** — "Suggest some quick tasks" → `preference=quick`, `mood=neutral`
- t1: remainMin null → DROPPED (can't prove quick)
- t2: 30 (high) + 25 (due today) + 25 (quick ≤30) = **80**
- t3: 10 (low) + 35 (overdue) + 25 (quick ≤30) = **70**

Output:
```
Work on:
• Write report (~30m, high)
• Clear inbox (~15m, low)

⚠️ Reminder: 1 task overdue — Clear inbox (3d late)
```

**Example 2** — "I'm a bit tired" → `mood=tired`, `preference=null`
- t1: 20 (medium) + 0 (tired, null est) + 10 (in_progress) = **30**
- t2: 30 (high) + 25 (due today) + 15 (tired ≤30) = **70**
- t3: 10 (low) + 35 (overdue) + 15 (tired ≤30) = **60**

Output:
```
Work on:
• Write report (~30m, high)
• Clear inbox (~15m, low)
• Đấm Thao (medium)

⚠️ Reminder: 1 task overdue — Clear inbox (3d late)
```

## Edge cases

- All tasks done → reply "Nothing left to do today 🎉". No overdue reminder.
- `preference=quick` drops every task → reply that there are no short tasks and offer to widen the filter.
- `remainMin` negative (logged > estimate) → clamp to 0, treat as a very short task.
- Multiple tasks tie on score → keep store order.
