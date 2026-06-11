const BASE_URL = 'http://localhost:3000'
const API_URL = `${BASE_URL}/api/chat`

export type TaskSource = 'jira' | 'notion' | 'google_calendar' | 'manual'
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
  subtasks: { id: string; title: string; status: string }[]
}

export interface ScheduleBlock {
  start: string
  end: string
  type: 'task' | 'break'
  task?: Task
  partial?: boolean
}

export interface Schedule {
  date: string
  start: string
  end: string
  blocks: ScheduleBlock[]
  unplaced: Task[]
}

export interface ChatResponse {
  ok: boolean
  message: string
  intent: { intent: string; clarification?: string; [key: string]: unknown }
  response: string
  tasks?: Task[]
  schedule?: Schedule
}

export type Provider = 'ollama' | 'gemini'

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

export async function sendChat(message: string): Promise<ChatResponse> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  const data = await res.json()

  if (!res.ok || !data.ok) {
    throw new Error(data?.error ?? `Request failed with status ${res.status}`)
  }

  return data as ChatResponse
}
