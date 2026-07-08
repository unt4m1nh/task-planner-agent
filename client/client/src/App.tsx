import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './Sidebar'
import ChatPanel, { type ChatPanelHandle } from './ChatPanel'
import ObsDashboard from './ObsDashboard'
import './App.css'
import { listSessions, type Schedule, type SessionSummary } from './lib/api'

type View = 'chat' | 'observe'

function App() {
  const [view, setView] = useState<View>('chat')
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined)
  const chatRef = useRef<ChatPanelHandle>(null)

  const refreshSessions = useCallback(() => {
    listSessions().then(setSessions).catch(() => {})
  }, [])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  function handleSelectSession(sessionId: string) {
    chatRef.current?.loadSession(sessionId)
  }

  function handleNewChat() {
    setSchedule(null)
    chatRef.current?.newChat()
  }

  function handleThreadIdChange(threadId: string | undefined) {
    setActiveSessionId(threadId)
    refreshSessions()
  }

  return (
    <div className="app">
      <Sidebar
        schedule={schedule}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        view={view}
        onViewChange={setView}
      />
      <div className="main">
        {view === 'chat' ? (
          <ChatPanel
            ref={chatRef}
            onSchedule={setSchedule}
            onThreadIdChange={handleThreadIdChange}
          />
        ) : (
          <ObsDashboard />
        )}
      </div>
    </div>
  )
}

export default App
