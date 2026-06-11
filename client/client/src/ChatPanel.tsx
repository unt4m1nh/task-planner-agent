import { useEffect, useRef, useState } from 'react'
import { sendChat, getProvider, setProvider, type Provider, type Task, type TaskStatus, type Schedule } from './lib/api'

interface Message {
  role: 'user' | 'agent' | 'error'
  text: string
  tasks?: Task[]
  schedule?: Schedule
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
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  scheduled: 'Scheduled',
}

function TaskCard({ task }: { task: Task }) {
  const source = SOURCE_LOGOS[task.source]
  return (
    <div className="task-card">
      <span className="source-logo" title={source?.label}>{source?.logo}</span>
      <div className="task-card-body">
        <div className="task-card-top">
          <span className="task-card-title">{task.title}</span>
          <span className="task-card-id">{task.id}</span>
        </div>
        <div className="task-card-meta">
          <span className={`chip status-${task.status}`}>{STATUS_LABELS[task.status] ?? task.status}</span>
          <span className={`chip priority-${task.priority}`}>{task.priority}</span>
          {task.due_date && <span className="task-card-due">due {task.due_date.slice(0, 10)}</span>}
          {task.tags.map(t => <span key={t} className="chip tag">#{t}</span>)}
        </div>
      </div>
    </div>
  )
}

function TaskList({ tasks }: { tasks: Task[] }) {
  const [tab, setTab] = useState<'all' | TaskStatus>('all')

  const statuses = (Object.keys(STATUS_LABELS) as TaskStatus[]).filter(
    s => tasks.some(t => t.status === s)
  )
  const filtered = tab === 'all' ? tasks : tasks.filter(t => t.status === tab)

  return (
    <div className="task-list">
      {tasks.length > 1 && statuses.length > 1 && (
        <div className="task-tabs">
          <button className={`task-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
            All <span className="tab-count">{tasks.length}</span>
          </button>
          {statuses.map(s => (
            <button key={s} className={`task-tab${tab === s ? ' active' : ''}`} onClick={() => setTab(s)}>
              {STATUS_LABELS[s]} <span className="tab-count">{tasks.filter(t => t.status === s).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="task-cards">
        {filtered.map(t => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  )
}

function DayPlan({ schedule }: { schedule: Schedule }) {
  return (
    <div className="day-plan">
      <div className="day-plan-header">
        <span className="day-plan-date">{schedule.date}</span>
        <span className="day-plan-window">{schedule.start}–{schedule.end}</span>
      </div>
      <div className="day-plan-events">
        {schedule.blocks.map((b, i) =>
          b.type === 'break' ? (
            <div key={i} className="plan-row">
              <span className="plan-time">{b.start}</span>
              <div className="plan-break">break</div>
            </div>
          ) : (
            <div key={i} className="plan-row">
              <span className="plan-time">{b.start}<br />{b.end}</span>
              <div className={`plan-event priority-edge-${b.task!.priority}`}>
                <div className="plan-event-top">
                  <span className="source-logo" title={SOURCE_LOGOS[b.task!.source]?.label}>
                    {SOURCE_LOGOS[b.task!.source]?.logo}
                  </span>
                  <span className="plan-event-title">{b.task!.title}</span>
                </div>
                <div className="plan-event-meta">
                  <span className={`chip priority-${b.task!.priority}`}>{b.task!.priority}</span>
                  <span className={`chip status-${b.task!.status}`}>{STATUS_LABELS[b.task!.status] ?? b.task!.status}</span>
                  {b.partial && <span className="chip partial">continue later</span>}
                </div>
              </div>
            </div>
          )
        )}
      </div>
      {schedule.unplaced.length > 0 && (
        <div className="day-plan-unplaced">
          Didn't fit today: {schedule.unplaced.slice(0, 5).map(t => t.title).join(', ')}
          {schedule.unplaced.length > 5 && ` +${schedule.unplaced.length - 5} more`}
        </div>
      )}
    </div>
  )
}

const TASK_LINE_RE = /\s*\|\s*(jira|notion|google_calendar|manual)\s*$/

function AgentText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const m = line.match(TASK_LINE_RE)
        if (!m) return <div key={i}>{line || ' '}</div>
        const source = SOURCE_LOGOS[m[1]]
        return (
          <div key={i} className="task-line">
            <span className="source-logo" title={source.label}>{source.logo}</span>
            <span>{line.slice(0, m.index)}</span>
          </div>
        )
      })}
    </>
  )
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', text: "Hi! Ask me to list, add, edit, reorder tasks — or ask what to work on next." },
  ])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [provider, setProviderState] = useState<Provider>('ollama')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    getProvider().then(setProviderState).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isSending])

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  async function handleProviderToggle(next: Provider) {
    await setProvider(next)
    setProviderState(next)
  }

  async function send(text: string) {
    if (!text || isSending) return

    setMessages(prev => [...prev, { role: 'user', text }])
    setIsSending(true)

    try {
      const { response, tasks, schedule } = await sendChat(text)
      setMessages(prev => [...prev, { role: 'agent', text: response, tasks, schedule }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setMessages(prev => [...prev, { role: 'error', text: msg }])
    } finally {
      setIsSending(false)
    }
  }

  function handleSubmit() {
    const text = input.trim()
    if (!text || isSending) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    send(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <>
      <header className="topbar">
        <span className="topbar-heading">New conversation</span>
      </header>

      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`chat-message-row ${m.role}`}>
            {m.role === 'user'
              ? <span className="avatar user-avatar"><UserIcon /></span>
              : <span className="avatar agent-avatar">✦</span>}
            <div className={`chat-bubble${m.tasks?.length || m.schedule ? ' has-tasks' : ''}`}>
              {m.schedule
                ? <DayPlan schedule={m.schedule} />
                : m.tasks?.length
                  ? <TaskList tasks={m.tasks} />
                  : m.role === 'agent' ? <AgentText text={m.text} /> : m.text}
            </div>
          </div>
        ))}

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
              <div className="provider-toggle">
              {(['ollama', 'gemini'] as Provider[]).map(p => (
                <button
                  key={p}
                  className={`provider-btn${provider === p ? ' active' : ''}`}
                  onClick={() => handleProviderToggle(p)}
                >
                  {p === 'ollama' ? 'Ollama' : 'Gemini'}
                </button>
              ))}
              </div>
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
