---
name: suggest-tasks
description: Score and recommend which tasks the user should work on, based on their mood, working preference, and available time. Use this whenever the classifier returns intent=suggest, or whenever the user asks what to do next, asks for quick/short tasks, says they are tired or low-energy, says they feel energetic, asks which task is most important, or asks what is due soon — even if they don't use the word "suggest". Overdue tasks are always surfaced first with a warning, regardless of what the user asked.
---

# Suggest Tasks

Pick the best 1–3 tasks for the user to work on right now. The model only extracts three slots from the user's message; all task selection is done by deterministic code so it is testable and never hallucinates a recommendation.

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

Read only these fields from each task object. Ignore everything else (`description`, `assignee`, `tags`, `subtasks`, `attachments`, `comments_count`, `url`, `source`, `created_at`, `updated_at`).

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

Compute these derived values for every task before scoring. `today` is passed in from the caller — never read the system clock inside the scoring function, so tests stay deterministic.

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

Use **remaining hours** (`estimate_hours − logged_hours`), not the raw estimate, so partially-logged work is rated by what is left. If logged exceeds estimate, clamp `remainHours` to 0 (treat as nearly finished).

## Step 2 — Split overdue tasks out first

Overdue tasks do **not** go through the scoring formula. Collect them into their own group and always surface them first with a warning, no matter what the user asked — even a "give me quick tasks" request must not hide an overdue item.

```text
overdue = tasks where isOverdue == true, sorted by lateness descending (latest first)
```

## Step 3 — Score the remaining tasks

Apply this to every task that is **not done** and **not overdue**.

```text
priorityScore = { high: 30, medium: 20, low: 10 }[priority]

# 1. base
score = priorityScore

# 2. due today
if isDueToday:                          score += 25

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

Sort the scored tasks by `score` descending and keep the **top 3**. On ties, preserve store order (stable sort).

## Step 4 — Return shape

Return two groups so the caller can render overdue separately from suggestions:

```json
{
  "overdue":   [ /* prepared tasks where isOverdue */ ],
  "suggested": [ /* top 1-3 by score */ ]
}
```

## Reply format

ALWAYS render overdue first when it is non-empty, then the suggestions.

**With overdue tasks:**
```
⚠️ {n} task(s) overdue — handle these first:
• {title} ({d} days late)
...

Otherwise, work on:
• {title} (~{remainMin}m, {priority})
...
```

**Without overdue tasks:**
```
Work on:
• {title} (~{remainMin}m, {priority})
...
```

Per-line rules:
- If `remainMin == null`, drop the `~{remainMin}m` part and show only `({priority})`.
- Always include `priority` so the user has context.
- Code fills this template directly; optionally let the model rewrite it into one natural sentence.

## Examples

Assume `today = 2026-06-10` and this store:

```json
[
  { "id": "t1", "title": "Đấm Thao", "status": "in_progress", "priority": "medium",
    "due_date": null, "estimate_hours": null, "logged_hours": null },
  { "id": "t2", "title": "Write report", "status": "todo", "priority": "high",
    "due_date": "2026-06-10T09:00:00Z", "estimate_hours": 0.5, "logged_hours": 0 },
  { "id": "t3", "title": "Clear inbox", "status": "todo", "priority": "low",
    "due_date": null, "estimate_hours": 0.25, "logged_hours": 0 }
]
```

**Example 1**
Input: "Suggest some quick tasks" → `preference=quick`, `mood=neutral`
- t1: remainMin null → DROPPED (quick can't be proven)
- t2: 30 (high) + 25 (due today) + 25 (quick ≤30) = **80**
- t3: 10 (low) + 25 (quick ≤30) = **35**
Output: suggest t2, then t3. t1 dropped.

**Example 2**
Input: "I'm a bit tired" → `mood=tired`, `preference=null`
- t1: 20 (medium) + 0 (tired, null est) + 10 (in_progress) = **30**
- t2: 30 (high) + 25 (due today) + 15 (tired ≤30) = **70**
- t3: 10 (low) + 15 (tired ≤30) = **25**
Output: suggest t2, t1, t3.

**Example 3**
Input: "I feel full of energy" → `mood=energetic`, `preference=null`
- t1: 20 (medium) + 20 (energetic doubles priority) + 10 (in_progress) = **50**
- t2: 30 (high) + 25 (due today) + 30 (energetic doubles priority) = **85**
- t3: 10 (low) + 10 (energetic doubles priority) = **20**
Output: suggest t2, t1, t3.

## Edge cases

- All tasks done → return empty groups; reply "Nothing left to do today 🎉".
- `preference=quick` drops every task (all estimates null) → show overdue if any; otherwise reply that there are no short tasks and offer to widen the filter.
- `remainMin` negative (logged > estimate) → clamp to 0, treat as a very short task.
- Multiple tasks tie on score → keep store order.
- Overdue group is independent: it shows even when `suggested` is empty.

## Suggested implementation split

| Function | Responsibility | Test type |
|---|---|---|
| `prepare(task, today)` | derive `remainMin, dueDate, isOverdue, isDueToday, isDone` | unit |
| `scoreTask(task, ctx, today)` | return `{ score, breakdown }` for one task | unit |
| `suggestTasks(tasks, ctx, today)` | filter + split overdue + score + top 3 | unit |
| `formatReply(result)` | build the chat text | snapshot |

Keep a `breakdown` of each score component for debugging and test assertions; strip it before sending the reply to chat.
