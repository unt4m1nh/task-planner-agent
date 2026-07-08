import { useCallback, useEffect, useState } from 'react'
import {
  getObsSummary, getObsEvents, getEvalRuns,
  type ObsSummary, type ObsEvent, type EvalRun,
} from './lib/api'

function fmtPct(n: number) {
  return (n * 100).toFixed(1) + '%'
}

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtLatency(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="obs-kpi-card">
      <span className="obs-kpi-value">{value}</span>
      <span className="obs-kpi-label">{label}</span>
      {sub && <span className="obs-kpi-sub">{sub}</span>}
    </div>
  )
}

function EvalBadge({ score }: { score: number }) {
  const pct = score * 100
  const cls = pct >= 80 ? 'obs-badge-ok' : pct >= 50 ? 'obs-badge-warn' : 'obs-badge-err'
  return <span className={`obs-badge ${cls}`}>{pct.toFixed(1)}%</span>
}

function SuccessBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="obs-badge obs-badge-null">—</span>
  return ok
    ? <span className="obs-badge obs-badge-ok">ok</span>
    : <span className="obs-badge obs-badge-err">fail</span>
}

export default function ObsDashboard() {
  const [summary, setSummary] = useState<ObsSummary | null>(null)
  const [events, setEvents] = useState<ObsEvent[]>([])
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, e, r] = await Promise.all([getObsSummary(), getObsEvents(50), getEvalRuns()])
      setSummary(s)
      setEvents(e)
      setEvalRuns(r)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const gs = summary?.guardrailStats
  const er = summary?.errorRate

  return (
    <div className="obs-root">
      <div className="obs-header">
        <span className="obs-title">Observability</span>
        <div className="obs-header-right">
          {lastRefresh && (
            <span className="obs-refresh-ts">
              {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button className="obs-refresh-btn" onClick={load} disabled={loading}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="obs-kpi-row">
        <KpiCard
          label="Guardrail checks"
          value={gs?.total ?? '—'}
          sub={gs ? `${fmtPct(gs.blockRate)} blocked (${gs.blocked})` : undefined}
        />
        <KpiCard
          label="Avg RAG iterations"
          value={summary?.avgRagIterations ?? '—'}
        />
        <KpiCard
          label="Errors"
          value={er?.errors ?? '—'}
          sub={er ? `${fmtPct(er.rate)} of ${er.total} events` : undefined}
        />
      </div>

      {summary && summary.perAgent.length > 0 && (
        <section className="obs-section">
          <h2 className="obs-section-title">Intent distribution</h2>
          <div className="obs-intent-list">
            {summary.perAgent.map(a => {
              const total = summary.perAgent.reduce((s, x) => s + x.count, 0)
              const pct = total ? (a.count / total) * 100 : 0
              return (
                <div key={a.intent} className="obs-intent-row">
                  <span className="obs-intent-name">{a.intent}</span>
                  <div className="obs-intent-bar-wrap">
                    <div className="obs-intent-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="obs-intent-count">{a.count}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="obs-section">
        <h2 className="obs-section-title">Eval runs</h2>
        {evalRuns.length === 0 ? (
          <span className="obs-empty">No eval runs yet — run <code>npm run eval</code> from <code>server/</code></span>
        ) : (
          <div className="obs-table-wrap">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Score</th>
                  <th>Cases</th>
                  <th>Note</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {evalRuns.map(r => (
                  <tr key={r.id}>
                    <td><span className="obs-eval-type">{r.eval_type}</span></td>
                    <td><EvalBadge score={r.score} /></td>
                    <td className="obs-num">{r.n_cases}</td>
                    <td className="obs-note">{r.note ?? '—'}</td>
                    <td className="obs-ts">{fmtTs(r.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="obs-section">
        <h2 className="obs-section-title">Recent events</h2>
        {events.length === 0 ? (
          <span className="obs-empty">No events yet — start the server and chat to generate events</span>
        ) : (
          <div className="obs-table-wrap">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Component</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id}>
                    <td className="obs-ts">{fmtTs(e.ts)}</td>
                    <td><span className="obs-component">{e.component}</span></td>
                    <td className="obs-event-type">{e.event_type}</td>
                    <td><SuccessBadge ok={e.success} /></td>
                    <td className="obs-num">{fmtLatency(e.latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
