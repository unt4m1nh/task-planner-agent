const store = require('../store')
const { suggestTasks } = require('./suggest')
const { planDay } = require('./planner')

function fmtPlanText(plan) {
  const lines = [`Plan for ${plan.date} (${plan.start}–${plan.end}):`]
  for (const b of plan.blocks) {
    if (b.type === 'break') {
      lines.push(`${b.start}–${b.end}  break`)
    } else {
      const partial = b.partial ? ' — start, continue later' : ''
      lines.push(`${b.start}–${b.end}  ${b.task.title} (${b.task.priority})${partial}`)
    }
  }
  if (plan.unplaced.length) {
    const names = plan.unplaced.slice(0, 5).map(t => t.title).join(', ')
    const more = plan.unplaced.length > 5 ? `, +${plan.unplaced.length - 5} more` : ''
    lines.push(`Didn't fit: ${names}${more}`)
  }
  if (plan.blocks.length === 0) lines.push('Nothing to schedule 🎉')
  return lines.join('\n')
}

function fmt(t) {
  const due = t.due_date ? t.due_date.slice(0, 10) : 'no due date'
  return `[${t.id}] ${t.title} | ${t.status} | ${t.priority} | ${due} | ${t.source}`
}

// Small models occasionally hallucinate a `query` from generic words in a bare
// "list everything" request (e.g. "show me all tasks" → query: "all tasks").
// Drop queries that reduce to nothing but filler words once tokenized.
const QUERY_STOPWORDS = new Set([
  'task', 'tasks', 'all', 'my', 'to', 'do', 'todo', 'todos', 'list', 'everything',
  'items', 'thing', 'things', 'stuff', 'the', 'a', 'an', 'show', 'me', 'please',
])

function sanitizeQuery(query) {
  if (!query) return undefined
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const meaningful = words.filter(w => !QUERY_STOPWORDS.has(w))
  if (!meaningful.length) return undefined
  return meaningful.join(' ')
}

function execute(intent) {
  const { intent: type, id, title, due, priority, tags, status, source, fields, append, to, refId, availableMinutes, mood, preference } = intent
  const rawQuery = [intent.query, ...(tags || [])].filter(Boolean).join(' ')
  const query = sanitizeQuery(rawQuery)

  switch (type) {
    case 'list': {
      const hasFilter = [status, priority, source, query].some(v => v != null && v !== '')
      const tasks = hasFilter
        ? store.filterTasks({ status, priority, source, query })
        : store.readTasks()
      if (!tasks.length) return 'No tasks found.'
      return { text: `${tasks.length} task(s):\n` + tasks.map(fmt).join('\n'), tasks }
    }

    case 'read': {
      if (!id) return 'Please specify which task to look up.'
      const tasks = store.readTasks(id)
      if (!tasks.length) return `Task "${id}" not found.`
      return { text: fmt(tasks[0]), tasks }
    }

    case 'add': {
      if (!title) return 'Please provide a title for the new task.'
      const task = store.writeTask({
        id: `manual-${Date.now()}`,
        source: 'manual',
        title,
        description: '',
        status: 'todo',
        priority: priority || 'medium',
        assignee: null,
        creator: null,
        tags: tags || [],
        due_date: due || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: null,
        subtasks: [],
        attachments: [],
        comments_count: 0,
        estimate_hours: null,
        logged_hours: null,
      })
      return `Created: [${task.id}] ${task.title}`
    }

    case 'edit': {
      if (!id) return 'Please specify the task id to edit.'
      if ((!fields || !Object.keys(fields).length) && (!append || !append.field || !append.value)) {
        return 'Please specify which fields to change, or what to append.'
      }

      const messages = []

      if (fields && Object.keys(fields).length) {
        const task = store.updateTask(id, fields)
        if (!task) return `Task "${id}" not found.`
        messages.push(`Updated: [${task.id}] ${task.title}`)
      }

      if (append && append.field && append.value) {
        const task = store.appendToTask(id, append.field, append.value)
        if (!task) return `Task "${id}" not found.`
        messages.push(`Appended to [${task.id}] ${task.title}`)
      }

      return messages.join('\n')
    }

    case 'reorder': {
      if (!id) return 'Please specify the task id to move.'
      if (!to) return 'Please specify where to move it: top, bottom, before <id>, or after <id>.'
      const tasks = store.reorderTask(id, to, refId)
      if (!tasks) return `Task "${id}" not found.`
      return `Moved task ${id} to ${to}${refId ? ' ' + refId : ''}.`
    }

    case 'suggest': {
      if (!availableMinutes && !mood && !preference) {
        return "To suggest the best task, it helps to know your situation — how many minutes do you have, how are you feeling, or what kind of task do you want? (e.g. \"30 minutes, feeling tired\" or \"something quick\")"
      }
      return suggestTasks({ mood, preference, availableMinutes })
    }

    case 'plan': {
      const plan = planDay(store.readTasks(), {
        date: intent.date,
        startTime: intent.startTime,
        endTime: intent.endTime,
        availableMinutes,
      })
      return { text: fmtPlanText(plan), schedule: plan }
    }

    case 'unknown':
      return intent.clarification || "I didn't understand that. Could you rephrase?"

    default:
      return "I didn't understand that. Try: list tasks, read a task, add a task, edit a task, reorder a task, or ask me to suggest what to work on."
  }
}

module.exports = { execute }
