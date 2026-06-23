import { useEffect, useRef, useState } from 'react'
import { sendChat, resumeChat, uploadDocument, type Task, type TaskStatus, type Schedule, type AwaitingInput } from './lib/api'

interface Message {
  role: 'user' | 'agent' | 'error'
  text: string
  tasks?: Task[]
  schedule?: Schedule
  awaitingInput?: AwaitingInput
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="14" y1="2" x2="2" y2="8" />
      <line x1="14" y1="2" x2="8" y2="14" />
      <line x1="14" y1="2" x2="2" y2="8" />
      <polyline points="2,8 8,14 14,2" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M5 5l3-3 3 3" />
      <path d="M2.5 10.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5.5" r="2.8" />
      <path d="M2.5 14c.8-2.8 3-4.2 5.5-4.2s4.7 1.4 5.5 4.2" />
    </svg>
  )
}

const SOURCE_LOGOS: Record<string, { label: string; logo: React.ReactNode }> = {
  jira: {
    label: 'Jira',
    logo: (
      <svg viewBox="0 0 24 24" fill="#2684FF">
        <path d="M11.53 2 5.84 7.69a1.6 1.6 0 0 0 0 2.26l5.69 5.7 1.13-1.14-4.56-4.56a.53.53 0 0 1 0-.75L12.66 4.6Z" />
        <path d="M12.47 22l5.69-5.69a1.6 1.6 0 0 0 0-2.26l-5.69-5.7-1.13 1.14 4.56 4.56a.53.53 0 0 1 0 .75l-4.56 4.6Z" opacity="0.7" />
      </svg>
    ),
  },
  notion: {
    label: 'Notion',
    logo: (
      <svg viewBox="0 0 24 24">
        <rect x="2.5" y="2.5" width="19" height="19" rx="3" fill="#fff" stroke="#37352f" strokeWidth="1.4" />
        <path d="M8 17V7.5l1.8-.2 5 7.6V7h2v10l-1.9.2-5-7.7V17Z" fill="#37352f" />
      </svg>
    ),
  },
  google_calendar: {
    label: 'Google Calendar',
    logo: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2.5" fill="#fff" stroke="#4285F4" strokeWidth="1.4" />
        <path d="M3 8h18" stroke="#4285F4" strokeWidth="1.4" />
        <path d="M7 3.5V6M17 3.5V6" stroke="#EA4335" strokeWidth="1.6" strokeLinecap="round" />
        <text x="12" y="17.5" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#4285F4" fontFamily="sans-serif">31</text>
      </svg>
    ),
  },
  manual: {
    label: 'Manual',
    logo: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#8e8b82" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  wire: {
    label: 'WIRE',
    logo: (
      <svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8M12 8v8" />
      </svg>
    ),
  },
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  scheduled: 'Scheduled',
}

function dueMeta(dueDate: string | null, today: string) {
  if (!dueDate) return null
  const d = dueDate.slice(0, 10)
  if (d < today) {
    const days = Math.round((Date.parse(today) - Date.parse(d)) / 86400000)
    return { text: `${days}d overdue`, cls: 'due-overdue' }
  }
  if (d === today) return { text: 'Due today', cls: 'due-today' }
  const days = Math.round((Date.parse(d) - Date.parse(today)) / 86400000)
  if (days === 1) return { text: 'Tomorrow', cls: 'due-soon' }
  if (days <= 7) return { text: `In ${days}d`, cls: 'due-soon' }
  return { text: d.slice(5).replace('-', '/'), cls: 'due-later' }
}

function sortByTime(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = a.due_date?.slice(0, 10)
    const bd = b.due_date?.slice(0, 10)
    if (!ad && !bd) return 0
    if (!ad) return 1
    if (!bd) return -1
    return ad < bd ? -1 : ad > bd ? 1 : 0
  })
}

function TaskCard({ task, today }: { task: Task; today: string }) {
  const source = SOURCE_LOGOS[task.source]
  const due = dueMeta(task.due_date, today)
  return (
    <div className={`task-card priority-bar-${task.priority}`}>
      <div className="task-card-header">
        <span className="source-logo" title={source?.label}>{source?.logo}</span>
        <span className="task-card-id">{task.id}</span>
      </div>
      <span className="task-card-title">{task.title}</span>
      <div className="task-card-meta">
        <span className={`chip status-${task.status}`}>{STATUS_LABELS[task.status] ?? task.status}</span>
        <span className={`chip priority-${task.priority}`}>{task.priority}</span>
      </div>
      <div className="task-card-footer">
        {due && <span className={`task-due-badge ${due.cls}`}>{due.text}</span>}
        <span className="task-card-tags">
          {task.tags.slice(0, 2).map(t => <span key={t} className="chip tag">#{t}</span>)}
        </span>
      </div>
    </div>
  )
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const [tab, setTab] = useState<'all' | TaskStatus>('all')
  const today = new Date().toISOString().slice(0, 10)
  const statuses = (Object.keys(STATUS_LABELS) as TaskStatus[]).filter(s => tasks.some(t => t.status === s))
  const base = tab === 'all' ? tasks : tasks.filter(t => t.status === tab)
  const sorted = sortByTime(base)
  return (
    <div className="task-list">
      <div className="task-list-header">
        <span className="task-list-count">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
        {tasks.length > 1 && statuses.length > 1 && (
          <div className="task-tabs">
            <button className={`task-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
              All
            </button>
            {statuses.map(s => (
              <button key={s} className={`task-tab${tab === s ? ' active' : ''}`} onClick={() => setTab(s)}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="task-grid">
        {sorted.map(t => <TaskCard key={t.id} task={t} today={today} />)}
      </div>
    </div>
  )
}

function durMin(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

function fmtDur(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function DayPlan({ schedule }: { schedule: Schedule }) {
  const label = new Date(schedule.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="day-plan">
      <div className="day-plan-header">
        <div className="day-plan-header-left">
          <span className="day-plan-date">{label}</span>
        </div>
        <span className="day-plan-window">{schedule.start} – {schedule.end}</span>
      </div>

      <div className="day-plan-events">
        {schedule.blocks.map((b, i) => {
          const d = durMin(b.start, b.end)

          if (b.kind === 'break' || b.kind === 'fixed') return (
            <div key={i} className="plan-break-row">
              <div className="plan-time-col">
                <span className="plan-t-start">{b.start}</span>
              </div>
              <div className="plan-break">
                <span className="plan-break-dot" />
                <span className="plan-break-label">{b.label ?? `${fmtDur(d)} break`}</span>
                <span className="plan-break-dot" />
              </div>
            </div>
          )

          const src = SOURCE_LOGOS[b.task!.source]
          return (
            <div key={i} className="plan-row">
              <div className="plan-time-col">
                <span className="plan-t-start">{b.start}</span>
                <span className="plan-t-end">{b.end}</span>
              </div>
              <div className="plan-track">
                <div className="plan-track-line" />
              </div>
              <div className={`plan-event priority-edge-${b.task!.priority}`}>
                <div className="plan-event-top">
                  <span className="source-logo" title={src?.label}>{src?.logo}</span>
                  <span className="plan-event-title">{b.task!.title}</span>
                  <span className="plan-dur-badge">{fmtDur(d)}</span>
                </div>
                <div className="plan-event-meta">
                  <span className={`chip priority-${b.task!.priority}`}>{b.task!.priority}</span>
                  <span className={`chip status-${b.task!.status}`}>{STATUS_LABELS[b.task!.status] ?? b.task!.status}</span>
                  {b.partial && <span className="chip partial">→ continue later</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {(schedule.dropped?.length ?? 0) > 0 && (
        <div className="day-plan-unplaced">
          <span className="day-plan-unplaced-label">⚠️ Didn't fit today</span>
          <div className="day-plan-unplaced-list">
            {schedule.dropped!.map((d, i) => (
              <span key={i} className="chip">{d.title}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const TASK_LINE_RE = /\s*\|\s*(jira|notion|google_calendar|manual|wire)\s*$/

function AgentText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const m = line.match(TASK_LINE_RE)
        if (!m) return <div key={i}>{line || ' '}</div>
        const source = SOURCE_LOGOS[m[1]]
        return (
          <div key={i} className="task-line">
            <span className="source-logo" title={source?.label}>{source?.logo}</span>
            <span>{line.slice(0, m.index)}</span>
          </div>
        )
      })}
    </>
  )
}

// ── HITL inline widgets ────────────────────────────────────────────────────────

function ClarifyWidget({
  onSubmit, disabled,
}: {
  awaiting: AwaitingInput
  onSubmit: (value: string) => void
  disabled: boolean
}) {
  const [value, setValue] = useState('')
  return (
    <div className="hitl-clarify">
      <input
        className="hitl-clarify-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) { e.preventDefault(); onSubmit(value.trim()) } }}
        placeholder="Reply…"
        autoFocus
        disabled={disabled}
      />
      <button
        className="hitl-clarify-send"
        onClick={() => { if (value.trim()) onSubmit(value.trim()) }}
        disabled={disabled || !value.trim()}
        aria-label="Send"
      >
        <SendIcon />
      </button>
    </div>
  )
}

function ApproveWidget({
  onSubmit, disabled,
}: {
  awaiting: AwaitingInput
  onSubmit: (value: string) => void
  disabled: boolean
}) {
  return (
    <div className="hitl-widget">
      <div className="hitl-approve-row">
        <button className="hitl-approve-btn" onClick={() => onSubmit('approve')} disabled={disabled}>
          Approve
        </button>
        <button className="hitl-reject-btn" onClick={() => onSubmit('reject')} disabled={disabled}>
          Reject
        </button>
      </div>
    </div>
  )
}

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export default function ChatPanel({ onSchedule }: { onSchedule?: (s: Schedule) => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', text: "Hi! Ask me to list, add, edit, delete, or reorder tasks — or ask what to work on next." },
  ])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  const [isUploading, setIsUploading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingHitlScheduleRef = useRef<Schedule | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  async function handleResponse(resPromise: Promise<import('./lib/api').ChatResponse>) {
    setIsSending(true)
    try {
      const res = await resPromise
      if (res.threadId) setThreadId(res.threadId)

      if (res.awaitingInput) {
        if (res.awaitingInput.schedule) pendingHitlScheduleRef.current = res.awaitingInput.schedule
        setMessages(prev => [...prev, {
          role: 'agent',
          text: res.awaitingInput!.question ?? res.awaitingInput!.summary ?? '',
          awaitingInput: res.awaitingInput,
        }])
      } else {
        setMessages(prev => [...prev, {
          role: 'agent',
          text: res.response ?? '',
          tasks: res.tasks,
          schedule: res.schedule,
        }])
        if (res.schedule) {
          onSchedule?.(res.schedule)
        } else if (pendingHitlScheduleRef.current) {
          onSchedule?.(pendingHitlScheduleRef.current)
          pendingHitlScheduleRef.current = null
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setMessages(prev => [...prev, { role: 'error', text: msg }])
    } finally {
      setIsSending(false)
    }
  }

  function send(text: string) {
    if (!text || isSending) return
    setMessages(prev => [...prev, { role: 'user', text }])
    handleResponse(sendChat(text, threadId))
  }

  function resume(value: string) {
    if (!threadId || isSending) return
    setMessages(prev => [...prev, { role: 'user', text: value }])
    handleResponse(resumeChat(value, threadId))
  }

  function handleSubmit() {
    const text = input.trim()
    if (!text || isSending) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    send(text)
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || isUploading) return
    setIsUploading(true)
    try {
      const { chunkCount, title } = await uploadDocument(file)
      setMessages(prev => [...prev, {
        role: 'agent',
        text: `Added "${title}" to your documents (${chunkCount} chunk${chunkCount !== 1 ? 's' : ''} indexed). Ask me anything about it.`,
      }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.'
      setMessages(prev => [...prev, { role: 'error', text: msg }])
    } finally {
      setIsUploading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Find the last agent message with awaitingInput (the active HITL widget)
  const lastAwaitingIdx = messages.reduce((last, m, i) => m.awaitingInput ? i : last, -1)

  return (
    <>
      <header className="topbar">
        <span className="topbar-heading">New conversation</span>
      </header>

      <div className="chat-messages">
        {messages.map((m, i) => {
          const avatar = m.role === 'user'
            ? <span className="avatar user-avatar"><UserIcon /></span>
            : <span className="avatar agent-avatar">✦</span>

          const hasRespondedAfter = messages.slice(i + 1).some(msg => msg.role === 'user')
          const isActiveHitl = m.awaitingInput && i === lastAwaitingIdx && !hasRespondedAfter

          const hasWide = !!(m.tasks?.length || m.schedule || m.awaitingInput?.schedule)
          const bubble = (
            <div className={`chat-bubble${hasWide ? ' has-tasks' : ''}`}>
              {m.schedule
                ? (
                  <>
                    <DayPlan schedule={m.schedule} />
                  </>
                )
                : m.tasks?.length
                  ? <TaskList tasks={m.tasks} />
                  : m.awaitingInput
                    ? (
                      <>
                        {m.awaitingInput.schedule
                          ? <DayPlan schedule={m.awaitingInput.schedule} />
                          : <AgentText text={m.text} />
                        }
                        {isActiveHitl && m.awaitingInput.kind === 'clarify' && (
                          <ClarifyWidget awaiting={m.awaitingInput} onSubmit={resume} disabled={isSending} />
                        )}
                        {isActiveHitl && m.awaitingInput.kind === 'approve' && (
                          <ApproveWidget awaiting={m.awaitingInput} onSubmit={resume} disabled={isSending} />
                        )}
                      </>
                    )
                    : m.role === 'agent' ? <AgentText text={m.text} /> : m.text}
            </div>
          )

          return (
            <div key={i} className={`chat-message-row ${m.role}`}>
              {m.role === 'user' ? <>{bubble}{avatar}</> : <>{avatar}{bubble}</>}
            </div>
          )
        })}

        {isSending && (
          <div className="chat-message-row agent">
            <span className="avatar agent-avatar">✦</span>
            <div className="pending-dots">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-wrap">
        <div className="chat-input-bar">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize() }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your tasks…"
            disabled={isSending}
          />
          <div className="chat-input-controls">
            <div className="chat-input-controls-left">
              <button
                className="plan-day-btn"
                onClick={() => send('/daily-planner')}
                disabled={isSending}
                title="Build a schedule for today (/daily-planner)"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <rect x="2" y="3" width="12" height="11" rx="2" />
                  <path d="M2 6.5h12M5.5 2v2.5M10.5 2v2.5" />
                </svg>
                Plan my day
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                hidden
                onChange={handleFileSelected}
              />
              <button
                className="plan-day-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title="Upload a PDF or DOCX to ask questions about it"
              >
                <UploadIcon />
                {isUploading ? 'Uploading…' : 'Upload doc'}
              </button>
            </div>
            <button
              className="send-btn"
              onClick={handleSubmit}
              disabled={isSending || !input.trim()}
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
