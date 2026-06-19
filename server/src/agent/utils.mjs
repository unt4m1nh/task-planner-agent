import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const store = require('../store.js')
const wire = require('../adapters/wire.js')

export function lastUserMsg(state) {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'user') return state.messages[i].content ?? ''
  }
  return ''
}

export function fmt(t) {
  const due = t.due_date ? t.due_date.slice(0, 10) : 'no due date'
  return `[${t.id}] ${t.title} | ${t.status} | ${t.priority} | ${due} | ${t.source}`
}

const QUERY_STOPWORDS = new Set([
  'task', 'tasks', 'all', 'my', 'to', 'do', 'todo', 'todos', 'list', 'everything',
  'items', 'thing', 'things', 'stuff', 'the', 'a', 'an', 'show', 'me', 'please',
])

export function sanitizeQuery(query) {
  if (!query) return undefined
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const meaningful = words.filter(w => !QUERY_STOPWORDS.has(w))
  return meaningful.length ? meaningful.join(' ') : undefined
}

// TIME_RANGE matches HH:MM–HH:MM with optional spaces around any dash variant.
const TIME_RANGE_RE = /(\d{2}:\d{2})\s*[–\-—]\s*(\d{2}:\d{2})/

// Parse LLM free-text plan output into a structured Schedule object.
// Returns null if the text doesn't contain a recognizable plan header.
export function parsePlanText(text, allTasks = []) {
  if (!text) return null
  const taskByTitle = new Map(allTasks.map(t => [t.title.toLowerCase().trim(), t]))

  // Strip all markdown fences (leading and trailing, any language tag)
  const cleaned = text.trim()
    .replace(/^```[a-z]*\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim()

  const lines = cleaned.split('\n')

  // Match "Plan for YYYY-MM-DD" anywhere in the line to handle prefixes like
  // "Updated Plan for…", "### Plan for…", "**Plan for…**" etc.
  const headerIdx = lines.findIndex(l => /plan for \d{4}-\d{2}-\d{2}/i.test(l))
  if (headerIdx < 0) return null

  const headerMatch = lines[headerIdx].match(
    new RegExp(`Plan for (\\d{4}-\\d{2}-\\d{2})\\s*(?:\\(${TIME_RANGE_RE.source}\\))?`, 'i')
  )
  if (!headerMatch) return null

  const [, date, start = '08:30', end = '17:30'] = headerMatch
  const blocks = []
  const unplaced = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    // Strip markdown bold/italic markers that models sometimes inject
    const line = lines[i].trim().replace(/\*\*?|__?/g, '')
    if (!line || line.startsWith('```')) continue

    if (/didn.t fit/i.test(line) || line.startsWith('⚠️')) {
      const after = line.replace(/^[^:]+:\s*/, '')
      after.split(',').forEach(t => {
        const title = t.trim()
        if (!title) return
        unplaced.push(
          taskByTitle.get(title.toLowerCase()) ||
          { id: `stub-${title.slice(0,8)}`, title, source: 'manual', status: 'todo', priority: 'medium', tags: [], due_date: null, estimate_hours: null, subtasks: [] }
        )
      })
      continue
    }

    // Block line: HH:MM–HH:MM  content (spaces around dash are optional)
    const m = line.match(new RegExp(`^${TIME_RANGE_RE.source}\\s+(.+)$`))
    if (!m) continue
    const [, bStart, bEnd, content] = m

    // Break: "break", "lunch", "lunch break", "lunch hour"
    if (/^(break|lunch\b)/i.test(content.trim())) {
      const isLunch = /^lunch/i.test(content.trim())
      blocks.push({ start: bStart, end: bEnd, type: 'break', ...(isLunch ? { label: 'lunch' } : {}) })
      continue
    }

    const priorityMatch = content.match(/^(.*?)\s*\((\w+)\)(\s*[–—-].*)?$/)
    const title = priorityMatch ? priorityMatch[1].trim() : content.trim()
    const partial = /partial/i.test(content)
    const task = taskByTitle.get(title.toLowerCase()) ||
      { id: `stub-${title.slice(0,8)}`, title, source: 'manual', status: 'todo', priority: priorityMatch?.[2] || 'medium', tags: [], due_date: null, estimate_hours: null, subtasks: [] }

    blocks.push({ start: bStart, end: bEnd, type: 'task', task, partial })
  }

  return { date, start, end, blocks, unplaced }
}

export function agentLog(node, fields) {
  const parts = [`[agent:${node}]`]
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue
    const s = typeof v === 'string' && v.length > 60 ? `"${v.slice(0, 57)}..."` : `${JSON.stringify(v)}`
    parts.push(`${k}=${s}`)
  }
  console.log(parts.join('  '))
}

export async function syncWire() {
  if (!wire.isConfigured()) return
  try {
    const n = await wire.syncTasks()
    console.log(`[wire] synced ${n} task(s)`)
  } catch (err) {
    console.warn(`[wire] sync skipped: ${err.message}`)
  }
}

export function fmtPlanText(plan) {
  const lines = [`Plan for ${plan.date} (${plan.start}–${plan.end}):`]
  for (const b of plan.blocks) {
    const kind = b.kind ?? b.type  // support both old (type) and new (kind) format
    if (kind === 'break') {
      lines.push(`${b.start}–${b.end}  break`)
    } else if (kind === 'fixed') {
      lines.push(`${b.start}–${b.end}  ${b.label || 'fixed'}`)
    } else if (b.task) {
      const suffix = b.partial ? ' — partial' : b.isEst ? ' ~est' : ''
      lines.push(`${b.start}–${b.end}  ${b.task.title} (${b.task.priority})${suffix}`)
    }
  }
  // Support both old (unplaced: Task[]) and new (dropped: {title}[]) formats
  const unfit = plan.dropped ?? plan.unplaced ?? []
  if (unfit.length) {
    const names = unfit.slice(0, 5).map(d => d.title ?? d).join(', ')
    const more = unfit.length > 5 ? `, +${unfit.length - 5} more` : ''
    lines.push(`Didn't fit: ${names}${more}`)
  }
  const taskBlocks = plan.blocks.filter(b => (b.kind ?? b.type) === 'task')
  if (taskBlocks.length === 0) lines.push('Nothing to schedule 🎉')
  return lines.join('\n')
}
