import { useState } from 'react'
import Sidebar from './Sidebar'
import ChatPanel from './ChatPanel'
import './App.css'
import type { Schedule } from './lib/api'

function App() {
  const [schedule, setSchedule] = useState<Schedule | null>(null)

  return (
    <div className="app">
      <Sidebar schedule={schedule} />
      <div className="main">
        <ChatPanel onSchedule={setSchedule} />
      </div>
    </div>
  )
}

export default App
