import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'os'
import path from 'path'
import fs from 'fs'
import * as historyStore from './store.mjs'

function tempDbPath() {
  return path.join(os.tmpdir(), `history-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function cleanup(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
}

test('addTurn then getRecentTurns returns chronological order', () => {
  const dbPath = tempDbPath()
  try {
    const sid = historyStore.getOrCreateSession(undefined, { dbPath })
    historyStore.addTurn(sid, 'user', 'first', { dbPath })
    historyStore.addTurn(sid, 'assistant', 'reply 1', { dbPath })
    historyStore.addTurn(sid, 'user', 'second', { dbPath })
    historyStore.addTurn(sid, 'assistant', 'reply 2', { dbPath })

    const turns = historyStore.getRecentTurns(sid, 10, { dbPath })
    assert.deepEqual(turns.map(t => t.content), ['first', 'reply 1', 'second', 'reply 2'])
    assert.deepEqual(turns.map(t => t.role), ['user', 'assistant', 'user', 'assistant'])
  } finally {
    cleanup(dbPath)
  }
})

test('getRecentTurns(_, N) on a session with > N turns returns exactly the last N', () => {
  const dbPath = tempDbPath()
  try {
    const sid = historyStore.getOrCreateSession(undefined, { dbPath })
    for (let i = 0; i < 12; i++) {
      historyStore.addTurn(sid, i % 2 === 0 ? 'user' : 'assistant', `turn-${i}`, { dbPath })
    }
    const turns = historyStore.getRecentTurns(sid, 4, { dbPath })
    assert.equal(turns.length, 4)
    assert.deepEqual(turns.map(t => t.content), ['turn-8', 'turn-9', 'turn-10', 'turn-11'])
  } finally {
    cleanup(dbPath)
  }
})

test('two sessions: turns never leak across session_id', () => {
  const dbPath = tempDbPath()
  try {
    const sidA = historyStore.getOrCreateSession(undefined, { dbPath })
    const sidB = historyStore.getOrCreateSession(undefined, { dbPath })
    assert.notEqual(sidA, sidB)

    historyStore.addTurn(sidA, 'user', 'hello from A', { dbPath })
    historyStore.addTurn(sidB, 'user', 'hello from B', { dbPath })

    const turnsA = historyStore.getRecentTurns(sidA, 10, { dbPath })
    const turnsB = historyStore.getRecentTurns(sidB, 10, { dbPath })
    assert.equal(turnsA.length, 1)
    assert.equal(turnsB.length, 1)
    assert.equal(turnsA[0].content, 'hello from A')
    assert.equal(turnsB[0].content, 'hello from B')
  } finally {
    cleanup(dbPath)
  }
})

test('getSessionResolvedContext reads the latest assistant turn JSON', () => {
  const dbPath = tempDbPath()
  try {
    const sid = historyStore.getOrCreateSession(undefined, { dbPath })
    historyStore.addTurn(sid, 'user', 'list my tasks', { dbPath })
    historyStore.addTurn(sid, 'assistant', 'here are 3 tasks', {
      dbPath, resolvedContext: { activeRoute: 'todo', activeIntent: 'list', lastListFilter: {} },
    })
    historyStore.addTurn(sid, 'user', 'now the high priority ones', { dbPath })
    historyStore.addTurn(sid, 'assistant', 'here is 1 task', {
      dbPath, resolvedContext: { activeRoute: 'todo', activeIntent: 'list', lastListFilter: { priority: 'high' } },
    })

    const ctx = historyStore.getSessionResolvedContext(sid, { dbPath })
    assert.deepEqual(ctx, { activeRoute: 'todo', activeIntent: 'list', lastListFilter: { priority: 'high' } })
  } finally {
    cleanup(dbPath)
  }
})

test('getSessionResolvedContext returns null when no assistant turn has resolved_context', () => {
  const dbPath = tempDbPath()
  try {
    const sid = historyStore.getOrCreateSession(undefined, { dbPath })
    historyStore.addTurn(sid, 'user', 'hi', { dbPath })
    assert.equal(historyStore.getSessionResolvedContext(sid, { dbPath }), null)
  } finally {
    cleanup(dbPath)
  }
})

test('getOrCreateSession resumes an existing id and creates a row for an unknown one', () => {
  const dbPath = tempDbPath()
  try {
    const sid = historyStore.getOrCreateSession(undefined, { dbPath })
    const resumed = historyStore.getOrCreateSession(sid, { dbPath })
    assert.equal(resumed, sid)

    const fixedId = 'thread-abc-123'
    const created = historyStore.getOrCreateSession(fixedId, { dbPath })
    assert.equal(created, fixedId)

    const sessions = historyStore.listSessions({ dbPath })
    assert.ok(sessions.some(s => s.sessionId === fixedId))
  } finally {
    cleanup(dbPath)
  }
})

test('listSessions returns title, updatedAt, and turn count, most recently updated first', () => {
  const dbPath = tempDbPath()
  try {
    const sidOld = historyStore.getOrCreateSession(undefined, { dbPath })
    historyStore.addTurn(sidOld, 'user', 'older session first message', { dbPath })

    const sidNew = historyStore.getOrCreateSession(undefined, { dbPath })
    historyStore.addTurn(sidNew, 'user', 'newer session first message', { dbPath })
    historyStore.addTurn(sidNew, 'assistant', 'reply', { dbPath })

    const sessions = historyStore.listSessions({ dbPath })
    assert.equal(sessions[0].sessionId, sidNew)
    assert.equal(sessions[0].turnCount, 2)
    assert.equal(sessions[0].title, 'newer session first message')
    assert.equal(sessions[1].sessionId, sidOld)
    assert.equal(sessions[1].turnCount, 1)
  } finally {
    cleanup(dbPath)
  }
})

test('formatWindowText renders role-prefixed lines in order', () => {
  const turns = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]
  assert.equal(historyStore.formatWindowText(turns), 'User: hi\nAssistant: hello')
  assert.equal(historyStore.formatWindowText([]), '')
})
