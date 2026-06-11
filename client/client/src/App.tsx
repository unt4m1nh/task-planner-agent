import ChatPanel from './ChatPanel'
import './App.css'

function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-mark">✦</span>
          <span className="sidebar-title">Task Agent</span>
        </div>
      </aside>

      <div className="main">
        <ChatPanel />
      </div>
    </div>
  )
}

export default App
