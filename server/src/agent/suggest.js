const { getToday } = require('../llm')
const store = require('../store')

const PRIORITY_SCORE = { critical: 40, high: 30, medium: 20, low: 10 }

function prepare(task, today) {
  const remainHours = task.estimate_hours != null
    ? Math.max(0, task.estimate_hours - (task.logged_hours || 0))
    : null
  const remainMin = remainHours !== null ? remainHours * 60 : null
  const dueDate = task.due_date ? task.due_date.slice(0, 10) : null
  const isOverdue  = dueDate !== null && dueDate < today
  const isDueToday = dueDate !== null && dueDate === today
  const isDone     = task.status === 'done'
  return { ...task, remainMin, dueDate, isOverdue, isDueToday, isDone }
}

function daysLate(dueDate, today) {
  return Math.ceil((new Date(today) - new Date(dueDate)) / 86400000)
}

function daysUntil(dueDate, today) {
  return Math.ceil((new Date(dueDate) - new Date(today)) / 86400000)
}

function scoreTask(task, { mood, preference }) {
  const base = PRIORITY_SCORE[task.priority] || 0
  let score = base
  let drop = false

  if (task.isDueToday) score += 25

  if (preference === 'quick') {
    if (task.remainMin === null)       { drop = true }
    else if (task.remainMin <= 30)     score += 25
    else if (task.remainMin <= 60)     score += 10
    else                               score -= 10
  }
  if (preference === 'important')      score += base
  if (preference === 'due_soon' && task.dueDate) {
    if (daysUntil(task.dueDate, getToday()) <= 2) score += 20
  }

  if (mood === 'tired') {
    if (task.remainMin !== null && task.remainMin <= 30) score += 15
    else if (task.remainMin === null || task.remainMin > 30) score -= 10
  }
  if (mood === 'energetic')            score += base

  if (task.status === 'in_progress')   score += 10

  return { score, drop }
}

function formatReply({ overdue, suggested, today }) {
  const lines = []

  if (overdue.length) {
    lines.push(`⚠️ ${overdue.length} task(s) overdue — handle these first:`)
    for (const t of overdue) {
      lines.push(`• ${t.title} (${daysLate(t.dueDate, today)} days late)`)
    }
    if (suggested.length) lines.push('\nOtherwise, work on:')
  } else if (suggested.length) {
    lines.push('Work on:')
  }

  for (const { task } of suggested) {
    const time = task.remainMin != null ? ` (~${Math.round(task.remainMin)}m,` : ' ('
    lines.push(`• ${task.title}${time} ${task.priority})`)
  }

  if (!overdue.length && !suggested.length) return 'Nothing left to do today 🎉'
  if (!suggested.length && overdue.length)  return lines.join('\n')
  return lines.join('\n')
}

function suggestTasks({ mood, preference, availableMinutes }) {
  const today = getToday()
  const all = store.readTasks().map(t => prepare(t, today)).filter(t => !t.isDone)

  const overdue   = all.filter(t => t.isOverdue).sort((a, b) => a.dueDate < b.dueDate ? 1 : -1)
  const remaining = all.filter(t => !t.isOverdue)

  const scored = remaining
    .map((task, storeIdx) => {
      const { score, drop } = scoreTask(task, { mood, preference })
      return { task, score, storeIdx, drop }
    })
    .filter(r => !r.drop)
    .filter(r => !availableMinutes || r.task.remainMin === null || r.task.remainMin <= availableMinutes)
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.storeIdx - b.storeIdx)

  const suggested = scored.slice(0, 3)

  return formatReply({ overdue, suggested, today })
}

module.exports = { suggestTasks, prepare, scoreTask }
