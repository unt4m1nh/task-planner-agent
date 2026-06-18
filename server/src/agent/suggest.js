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
  if (task.isOverdue)  score += 35

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

function formatReply({ suggested, overdue, today }) {
  if (!suggested.length && !overdue.length) return 'Nothing left to do today 🎉'

  const lines = []

  if (suggested.length) {
    lines.push('Work on:')
    for (const { task } of suggested) {
      const time = task.remainMin != null ? ` (~${Math.round(task.remainMin)}m,` : ' ('
      lines.push(`• ${task.title}${time} ${task.priority})`)
    }
  }

  if (overdue.length) {
    const items = overdue.map(t => `${t.title} (${daysLate(t.dueDate, today)}d late)`).join(', ')
    lines.push(`\n⚠️ Reminder: ${overdue.length} task(s) overdue — ${items}`)
  }

  return lines.join('\n')
}

function suggestTasks({ mood, preference, availableMinutes }) {
  const today = getToday()
  const all = store.readTasks().map(t => prepare(t, today)).filter(t => !t.isDone)

  const scored = all
    .map((task, storeIdx) => {
      const { score, drop } = scoreTask(task, { mood, preference })
      return { task, score, storeIdx, drop }
    })
    .filter(r => !r.drop)
    .filter(r => !availableMinutes || r.task.remainMin === null || r.task.remainMin <= availableMinutes)
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.storeIdx - b.storeIdx)

  const suggested = scored.slice(0, 3)
  const overdue = all.filter(t => t.isOverdue)

  return formatReply({ suggested, overdue, today })
}

module.exports = { suggestTasks, prepare, scoreTask }
