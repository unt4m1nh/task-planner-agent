import { useEffect, useState } from 'react'
import { getProvider, setProvider, type Provider, type Schedule } from './lib/api'

const MODELS: { id: Provider; name: string; tier: string; detail: string; glyph: React.ReactNode }[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    tier: 'Local',
    detail: 'gemma4:2b',
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="9" width="16" height="11" rx="3" />
        <path d="M7 9V6.5a2 2 0 0 1 2-2M17 9V6.5a2 2 0 0 0-2-2" />
        <circle cx="9.5" cy="14" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="14" r="1" fill="currentColor" stroke="none" />
        <path d="M10 17.5h4" />
      </svg>
    ),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tier: 'Cloud',
    detail: 'gemma4:26b',
    glyph: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8Z" />
      </svg>
    ),
  },
]

const SOURCE_LABELS: Record<string, string> = {
  jira: 'Jira',
  notion: 'Notion',
  google_calendar: 'Calendar',
  manual: 'Manual',
  wire: 'WIRE',
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function fmtDurShort(start: string, end: string): string {
  const d = timeToMin(end) - timeToMin(start)
  if (d < 60) return `${d}m`
  const h = Math.floor(d / 60)
  const m = d % 60
  return m ? `${h}h${m}m` : `${h}h`
}

function NoPlanIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="10" width="36" height="32" rx="5" />
      <path d="M6 19h36" />
      <path d="M16 6v7M32 6v7" />
      <path d="M14 28h8M14 34h14" />
    </svg>
  )
}

function DoneIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="18" />
      <path d="M15 24l7 7 11-13" />
    </svg>
  )
}

function LunchIcon() {
  return (
    <svg viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* fork: two outer tines + handle */}
      <path d="M2 1v4c0 1.1.9 2 2 2v7" />
      <path d="M4 1v3.5" />
      <path d="M6 1v4c0 1.1-.9 2-2 2" />
      {/* knife: blade tapers into handle */}
      <path d="M10 1c1.5 1.2 2 3 2 4.5H10V15" />
    </svg>
  )
}

function PlanTimeline({ schedule }: { schedule: Schedule }) {
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date()
      setNowMin(n.getHours() * 60 + n.getMinutes())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const endMin = timeToMin(schedule.end)
  const isDone = nowMin >= endMin

  const dateLabel = new Date(schedule.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  if (isDone) {
    return (
      <div className="sidebar-plan">
        <span className="sidebar-plan-label">Today's Plan</span>
        <div className="sidebar-plan-done">
          <span className="sidebar-plan-done-icon"><DoneIcon /></span>
          <span className="sidebar-plan-done-heading">Day complete!</span>
          <span className="sidebar-plan-done-sub">Plan finished · {schedule.end}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="sidebar-plan">
      <div className="sidebar-plan-header">
        <span className="sidebar-plan-label">Today's Plan</span>
        <span className="sidebar-plan-window">{schedule.start}–{schedule.end}</span>
      </div>
      <span className="sidebar-plan-date">{dateLabel}</span>

      <div className="sidebar-timeline">
        {schedule.blocks.map((b, i) => {
          const startMin = timeToMin(b.start)
          const blockEndMin = timeToMin(b.end)
          const isPast = nowMin >= blockEndMin
          const isCurrent = nowMin >= startMin && nowMin < blockEndMin

          if (b.type === 'break') {
            const isLunch = b.label === 'lunch'
            if (isLunch) {
              return (
                <div key={i} className={`stl-lunch${isPast ? ' stl-past' : ''}`}>
                  <span className="stl-lunch-icon"><LunchIcon /></span>
                  <span className="stl-lunch-label">Lunch</span>
                  <span className="stl-lunch-time">{b.start}–{b.end}</span>
                </div>
              )
            }
            return (
              <div key={i} className={`stl-break${isPast ? ' stl-past' : ''}`}>
                <div className="stl-spine" />
                <span className="stl-break-label">
                  {fmtDurShort(b.start, b.end)} break
                </span>
              </div>
            )
          }

          if (isCurrent) {
            const task = b.task!
            const remainHours = task.estimate_hours != null
              ? (task.logged_hours != null && task.logged_hours > 0
                ? Math.max(0, task.estimate_hours - task.logged_hours)
                : task.estimate_hours)
              : null
            const dueLabel = task.due_date
              ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : null

            return (
              <div key={i} className="stl-row stl-current">
                <div className="stl-left">
                  <span className="stl-dot" />
                  <div className="stl-spine" />
                </div>
                <div className="stl-current-card">
                  <div className="stl-now-row">
                    <span className="stl-now-badge">NOW</span>
                    <span className="stl-dur">{fmtDurShort(b.start, b.end)}</span>
                  </div>
                  <span className="stl-current-title-full">{task.title}</span>
                  <div className="stl-current-time-row">
                    <span className="stl-time">{b.start}</span>
                    <span className="stl-current-arrow">→</span>
                    <span className="stl-time">{b.end}</span>
                  </div>
                  <div className="stl-current-chips">
                    <span className={`stl-chip stl-prio-${task.priority}`}>{task.priority}</span>
                    <span className="stl-chip stl-src">{SOURCE_LABELS[task.source] ?? task.source}</span>
                  </div>
                  {(dueLabel || remainHours != null) && (
                    <div className="stl-current-extra">
                      {dueLabel && <span>due {dueLabel}</span>}
                      {remainHours != null && <span>~{remainHours % 1 === 0 ? remainHours : remainHours.toFixed(1)}h left</span>}
                    </div>
                  )}
                </div>
              </div>
            )
          }

          return (
            <div key={i} className={`stl-row${isPast ? ' stl-past' : ''}`}>
              <div className="stl-left">
                <span className="stl-dot" />
                <div className="stl-spine" />
              </div>
              <div className="stl-body">
                <span className="stl-time">{b.start}</span>
                <span className="stl-title">{b.task!.title}</span>
                <span className="stl-dur">{fmtDurShort(b.start, b.end)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {schedule.unplaced.length > 0 && (
        <div className="sidebar-plan-unplaced">
          +{schedule.unplaced.length} didn't fit
        </div>
      )}
    </div>
  )
}

function NoPlan() {
  return (
    <div className="sidebar-plan">
      <span className="sidebar-plan-label">Today's Plan</span>
      <div className="sidebar-plan-empty">
        <span className="sidebar-plan-empty-icon"><NoPlanIcon /></span>
        <span className="sidebar-plan-empty-heading">No plan yet</span>
        <span className="sidebar-plan-empty-sub">Ask me to plan your day</span>
      </div>
    </div>
  )
}

export default function Sidebar({ schedule }: { schedule?: Schedule | null }) {
  const [provider, setProviderState] = useState<Provider>('ollama')

  useEffect(() => {
    getProvider().then(setProviderState).catch(() => {})
  }, [])

  async function choose(next: Provider) {
    if (next === provider) return
    setProviderState(next)
    try {
      await setProvider(next)
    } catch {
      // revert is handled implicitly on next load; keep optimistic UI
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-mark">✦</span>
        <span className="sidebar-title">Task Agent</span>
      </div>

      <div className="model-switch">
        <span className="model-switch-label">Model</span>
        <div className="model-options">
          {MODELS.map(m => (
            <button
              key={m.id}
              className={`model-option${provider === m.id ? ' active' : ''}`}
              onClick={() => choose(m.id)}
              aria-pressed={provider === m.id}
            >
              <span className="model-glyph">{m.glyph}</span>
              <span className="model-meta">
                <span className="model-name">{m.name}</span>
                <span className="model-detail">{m.tier} · {m.detail}</span>
              </span>
              <span className="model-dot" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-divider" />

      {schedule ? <PlanTimeline schedule={schedule} /> : <NoPlan />}
    </aside>
  )
}
