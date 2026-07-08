const BASE_URL = 'http://localhost:3000'

export type TaskSource = 'jira' | 'notion' | 'google_calendar' | 'manual' | 'wire'
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'scheduled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

export interface Task {
  id: string
  source: TaskSource
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  tags: string[]
  due_date: string | null
  estimate_hours: number | null
  logged_hours?: number | null
  subtasks: { id: string; title: string; status: string }[]
}

export interface ScheduleBlock {
  start: string
  end: string
  kind: 'task' | 'break' | 'fixed'
  task?: Task
  partial?: boolean
  isEst?: boolean
  label?: string
}


export interface DroppedTask {
  taskId: string
  title: string
  reason: string
}

export interface Schedule {
  date: string
  start: string
  end: string
  blocks: ScheduleBlock[]
  dropped: DroppedTask[]
}

export interface AwaitingInput {
  kind: 'clarify' | 'approve'
  question?: string
  summary?: string
  missingSlot?: string
  options?: string[]
  schedule?: Schedule
}

export interface ChatResponse {
  ok: boolean
  threadId: string
  message?: string
  intent?: { intent: string; [key: string]: unknown }
  response?: string
  tasks?: Task[]
  schedule?: Schedule
  awaitingInput?: AwaitingInput
}

export type Provider = 'ollama' | 'gemini' | 'gemini-flash' | 'gemma-31b'

export async function getProvider(): Promise<Provider> {
  const res = await fetch(`${BASE_URL}/api/provider`)
  const data = await res.json()
  return data.provider as Provider
}

export async function setProvider(provider: Provider): Promise<void> {
  await fetch(`${BASE_URL}/api/provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
}

export async function sendChat(message: string, threadId?: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      ...(threadId ? { threadId } : {}),
    }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data?.error ?? `Request failed with status ${res.status}`)
  }
  return data as ChatResponse
}

export interface UploadDocumentResponse {
  ok: boolean
  documentId: number
  chunkCount: number
  title: string
}

export async function uploadDocument(file: File): Promise<UploadDocumentResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${BASE_URL}/api/rag/upload`, {
    method: 'POST',
    body: formData,
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data?.error ?? `Upload failed with status ${res.status}`)
  }
  return data as UploadDocumentResponse
}

export interface SessionSummary {
  sessionId: string
  title: string | null
  createdAt: number
  updatedAt: number
  turnCount: number
}

export interface SessionTurn {
  turnId: number
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  intent: string | null
  resolvedContext: Record<string, unknown> | null
  createdAt: number
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${BASE_URL}/api/sessions`)
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data?.error ?? `Request failed with status ${res.status}`)
  }
  return data.sessions as SessionSummary[]
}

export async function getSession(sessionId: string): Promise<{ session: SessionSummary; turns: SessionTurn[] }> {
  const res = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`)
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data?.error ?? `Request failed with status ${res.status}`)
  }
  return { session: data.session, turns: data.turns }
}

export async function resumeChat(resume: string, threadId: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume, threadId }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data?.error ?? `Request failed with status ${res.status}`)
  }
  return data as ChatResponse
}
