import { createRequire } from 'module'
import { interrupt } from '@langchain/langgraph'
import { HITL } from './state.mjs'
import { fmt, sanitizeQuery, agentLog, syncWire } from './utils.mjs'

const require = createRequire(import.meta.url)
const { classify } = require('./classify.js')
const store = require('../store.js')
const wire = require('../adapters/wire.js')
const { validateTodoSlots, isDestructive, describeAction } = require('./contract.js')

export async function todoUnderstand(state) {
  const slots = state.todoSlots
  const validation = validateTodoSlots(slots)
  if (!validation.ok) {
    agentLog('todo_understand', { intent: slots?.intent, action: 'clarify', missing: validation.missingSlot })
    return {
      pendingAction: { type: 'clarify', missingSlot: validation.missingSlot, question: validation.question },
    }
  }
  if (HITL.todo_confirm && isDestructive(slots)) {
    agentLog('todo_understand', { intent: slots?.intent, action: 'confirm' })
    return { pendingAction: { type: 'confirm', summary: describeAction(slots) } }
  }
  agentLog('todo_understand', { intent: slots?.intent, action: 'execute' })
  return { pendingAction: null }
}

export async function todoClarify(state) {
  const { question, missingSlot } = state.pendingAction
  agentLog('todo_clarify', { INTERRUPT: true, kind: 'clarify', missing: missingSlot })
  const answer = interrupt({ kind: 'clarify', question, missingSlot })
  const updated = { ...(state.todoSlots || {}) }

  if (missingSlot === 'id') {
    const raw = answer.trim()
    const tasks = store.readTasks()
    const byId = tasks.find(t => t.id.toLowerCase() === raw.toLowerCase())
    if (byId) {
      updated.id = byId.id
    } else {
      const byTitle = tasks.find(t => t.title.toLowerCase().includes(raw.toLowerCase()))
      if (byTitle) {
        agentLog('todo_clarify', { resolved: 'title→id', id: byTitle.id, title: byTitle.title })
        updated.id = byTitle.id
      } else {
        updated.id = raw
      }
    }
  } else if (missingSlot === 'fields') {
    // Re-classify the answer to extract structured edit fields
    const context = `edit task ${updated.id ? updated.id + ': ' : ''}${answer}`
    const reclassified = await classify(context)
    if (reclassified.fields && Object.keys(reclassified.fields).length) {
      updated.fields = reclassified.fields
    }
    if (reclassified.append?.field && reclassified.append?.value) {
      updated.append = reclassified.append
    }
    agentLog('todo_clarify', { reclassified: true, fields: updated.fields, append: updated.append })
  } else {
    updated[missingSlot] = answer
  }

  return { todoSlots: updated, pendingAction: null }
}

export async function todoConfirm(state) {
  const { summary } = state.pendingAction
  agentLog('todo_confirm', { INTERRUPT: true, kind: 'approve', intent: state.todoSlots?.intent })
  const decision = interrupt({ kind: 'approve', summary, options: ['approve', 'reject'] })
  agentLog('todo_confirm', { decision, intent: state.todoSlots?.intent })
  if (decision === 'approve') {
    return { pendingAction: null }
  }
  return {
    result: { intent: state.todoSlots?.intent, response: "Okay, cancelled. What else can I help with?" },
    pendingAction: null,
  }
}

export async function todoExecute(state) {
  const slots = state.todoSlots
  const { intent: type, id, title, due, priority, tags, status, source, fields, append } = slots
  const rawQuery = [slots.query, ...(tags || [])].filter(Boolean).join(' ')
  const query = sanitizeQuery(rawQuery)

  let response, tasks

  switch (type) {
    case 'list': {
      await syncWire()
      const hasFilter = [status, priority, source, query].some(v => v != null && v !== '')
      const all = hasFilter
        ? store.filterTasks({ status, priority, source, query })
        : store.readTasks()
      if (!all.length) { response = 'No tasks found.'; break }
      response = `${all.length} task(s):\n` + all.map(fmt).join('\n')
      tasks = all
      break
    }

    case 'read': {
      await syncWire()
      const found = store.readTasks(id)
      if (!found.length) { response = `Task "${id}" not found.`; break }
      response = fmt(found[0])
      tasks = found
      break
    }

    case 'add': {
      if (source === wire.WIRE_SOURCE) {
        if (!wire.isConfigured()) { response = 'WIRE is not configured.'; break }
        try {
          const created = await wire.createTask({
            title, description: '',
            ...(priority ? { priority } : {}),
            ...(tags?.length ? { tags } : {}),
            ...(due ? { due_date: due } : {}),
          })
          const newId = created?.id || created?.key
          response = `Created WIRE issue${newId ? ` [${newId}]` : ''}: ${title}`
        } catch (err) { response = `Couldn't create WIRE issue: ${err.message}` }
        break
      }
      const task = store.writeTask({
        id: `manual-${Date.now()}`, source: 'manual', title, description: '',
        status: 'todo', priority: priority || 'medium',
        assignee: null, creator: null, tags: tags || [],
        due_date: due || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        url: null, subtasks: [], attachments: [], comments_count: 0,
        estimate_hours: null, logged_hours: null,
      })
      response = `Created: [${task.id}] ${task.title}`
      break
    }

    case 'edit': {
      const existing = store.readTasks(id)[0]
      if (!existing) { response = `Task "${id}" not found.`; break }

      if (existing.source === wire.WIRE_SOURCE) {
        if (!wire.isConfigured()) { response = 'WIRE is not configured.'; break }
        const patch = { ...(fields || {}) }
        if (append?.field === 'tags') patch.tags = [...(existing.tags || []), append.value]
        else if (append?.field === 'title') patch.title = `${existing.title} ${append.value}`
        try {
          await wire.editTask(id, patch)
          response = `Updated WIRE issue [${id}]`
        } catch (err) { response = `Couldn't update WIRE issue: ${err.message}` }
        break
      }

      const msgs = []
      if (fields && Object.keys(fields).length) {
        const t = store.updateTask(id, fields)
        if (!t) { response = `Task "${id}" not found.`; break }
        msgs.push(`Updated: [${t.id}] ${t.title}`)
      }
      if (append?.field && append?.value) {
        const t = store.appendToTask(id, append.field, append.value)
        if (!t) { response = `Task "${id}" not found.`; break }
        msgs.push(`Appended to [${t.id}] ${t.title}`)
      }
      response = msgs.join('\n') || 'No changes made.'
      break
    }

    case 'delete': {
      const deleted = store.deleteTask(id)
      if (!deleted) { response = `Task "${id}" not found.`; break }
      response = `Deleted: [${deleted.id}] ${deleted.title}`
      break
    }

    default:
      response = "I didn't understand that. Try: list, add, edit, delete, or read a task."
  }

  agentLog('todo_execute', { intent: type, id, title, response })
  return { result: { intent: type, response, ...(tasks ? { tasks } : {}) } }
}
