const fs = require('fs')
const path = require('path')

const TASKS_PATH = path.resolve(__dirname, '../../task.json')

function load() {
  const raw = fs.readFileSync(TASKS_PATH, 'utf-8')
  return JSON.parse(raw)
}

function save(data) {
  data.meta.total = data.tasks.length
  fs.writeFileSync(TASKS_PATH, JSON.stringify(data, null, 2))
}

function readTasks(id) {
  const { tasks } = load()
  if (id) return tasks.filter(t => t.id === id)
  return tasks
}

function writeTask(task) {
  const data = load()
  data.tasks.push(task)
  save(data)
  return task
}

function filterTasks({ status, priority, source, tags, query }) {
  let { tasks } = load()
  if (status) tasks = tasks.filter(t => t.status === status)
  if (priority) tasks = tasks.filter(t => t.priority === priority)
  if (source) tasks = tasks.filter(t => t.source === source)
  if (tags && tags.length) {
    tasks = tasks.filter(t => t.tags && tags.some(tag => t.tags.includes(tag)))
  }
  if (query) {
    const q = query.toLowerCase()
    const qNorm = q.replace(/[^a-z0-9]/g, '')
    tasks = tasks.filter(t => {
      if (t.title.toLowerCase().includes(q)) return true
      if (t.description && t.description.toLowerCase().includes(q)) return true
      if (t.tags && t.tags.some(tag => tag.toLowerCase().replace(/[^a-z0-9]/g, '').includes(qNorm))) return true
      return false
    })
  }
  return tasks
}

function appendToTask(id, field, value) {
  const data = load()
  const task = data.tasks.find(t => t.id === id)
  if (!task) return null
  if (field === 'tags') {
    task.tags = task.tags || []
    if (!task.tags.includes(value)) task.tags.push(value)
  } else if (field === 'subtasks') {
    task.subtasks = task.subtasks || []
    task.subtasks.push({ id: `sub-${Date.now()}`, title: value, status: 'todo' })
  } else if (field === 'title') {
    task.title = task.title + ' ' + value
  }
  task.updated_at = new Date().toISOString()
  save(data)
  return task
}

function upsertTasks(rows) {
  if (!rows || !rows.length) return 0
  const data = load()
  for (const row of rows) {
    const existing = data.tasks.find(t => t.id === row.id)
    if (existing) Object.assign(existing, row)
    else data.tasks.push(row)
  }
  save(data)
  return rows.length
}

function updateTask(id, fields) {
  const data = load()
  const task = data.tasks.find(t => t.id === id)
  if (!task) return null
  Object.assign(task, fields)
  task.updated_at = new Date().toISOString()
  save(data)
  return task
}

function reorderTask(id, to, refId) {
  const data = load()
  const idx = data.tasks.findIndex(t => t.id === id)
  if (idx === -1) return null
  const [task] = data.tasks.splice(idx, 1)
  if (to === 'top') {
    data.tasks.unshift(task)
  } else if (to === 'bottom') {
    data.tasks.push(task)
  } else if (to === 'before' && refId) {
    const ref = data.tasks.findIndex(t => t.id === refId)
    data.tasks.splice(ref === -1 ? data.tasks.length : ref, 0, task)
  } else if (to === 'after' && refId) {
    const ref = data.tasks.findIndex(t => t.id === refId)
    data.tasks.splice(ref === -1 ? data.tasks.length : ref + 1, 0, task)
  } else {
    data.tasks.push(task)
  }
  save(data)
  return data.tasks
}

function deleteTask(id) {
  const data = load()
  const idx = data.tasks.findIndex(t => t.id === id)
  if (idx === -1) return null
  const [task] = data.tasks.splice(idx, 1)
  save(data)
  return task
}

module.exports = { readTasks, writeTask, filterTasks, appendToTask, updateTask, reorderTask, upsertTasks, deleteTask }
