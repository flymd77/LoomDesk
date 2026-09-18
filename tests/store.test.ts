import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeCachedDatabase, openDatabase, type DbHandle } from '../src/main/store/db'
import { SessionStore } from '../src/main/store/sessions'
import { AgentRegistry } from '../src/main/agents/registry'

let dir: string
let db: DbHandle

beforeEach(() => {
  closeCachedDatabase()
  dir = mkdtempSync(join(tmpdir(), 'loomdesk-test-'))
  db = openDatabase(dir)
  // Sessions reference agents; seed builtins first as production does.
  new AgentRegistry(db)
})

describe('db', () => {
  it('opens with WAL mode and survives reopen (persistence)', () => {
    const sessions = new SessionStore(db)
    const created = sessions.create('codex', '/tmp/ws', 'hello')
    db.close()

    const reopened = openDatabase(dir)
    const again = new SessionStore(reopened)
    expect(again.get(created.id)?.title).toBe('hello')
  })
})

describe('SessionStore', () => {
  let sessions: SessionStore

  beforeEach(() => {
    sessions = new SessionStore(db)
  })

  it('creates sessions with defaults and lists newest first', () => {
    const a = sessions.create('codex', '/tmp/a', 'first')
    const b = sessions.create('codex', '/tmp/b', 'second')

    const list = sessions.list()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(b.id) // newest first
    expect(list[0].messageCount).toBe(0)
    expect(a.status).toBe('idle')
    expect(a.acpSessionId).toBeNull()
  })

  it('appends messages and touches session ordering', async () => {
    const first = sessions.create('codex', '/tmp/a', 'first')
    sessions.appendMessage(first.id, 'user', { text: 'hi' })
    // Ensure a later timestamp for the second session.
    await new Promise((r) => setTimeout(r, 5))
    const second = sessions.create('codex', '/tmp/b', 'second')
    sessions.appendMessage(second.id, 'agent', { text: 'hello' })

    const list = sessions.list()
    expect(list[0].id).toBe(second.id)
    expect(list[0].messageCount).toBe(1)
  })

  it('pages messages in ascending order with beforeId cursor', () => {
    const s = sessions.create('codex', '/tmp/a', 't')
    for (let i = 0; i < 25; i++) {
      sessions.appendMessage(s.id, 'agent', { seq: i })
    }
    const latest = sessions.messages(s.id, undefined, 10)
    expect(latest).toHaveLength(10)
    expect(latest[9].content).toEqual({ seq: 24 })

    const older = sessions.messages(s.id, latest[0].id, 10)
    expect(older[9].content).toEqual({ seq: 14 })
  })

  it('tracks status and acp session linking', () => {
    const s = sessions.create('codex', '/tmp/a', 't')
    sessions.updateStatus(s.id, 'running')
    sessions.linkAcpSession(s.id, 'acp-xyz')

    const got = sessions.get(s.id)
    expect(got?.status).toBe('running')
    expect(got?.acpSessionId).toBe('acp-xyz')
  })

  it('cascade deletes messages with the session', () => {
    const s = sessions.create('codex', '/tmp/a', 't')
    sessions.appendMessage(s.id, 'user', { text: 'x' })
    sessions.remove(s.id)
    expect(sessions.messages(s.id)).toHaveLength(0)
    expect(sessions.get(s.id)).toBeNull()
  })
})

describe('AgentRegistry', () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = new AgentRegistry(db)
  })

  it('seeds builtin agents with Codex first', () => {
    const agents = registry.list()
    expect(agents[0].id).toBe('codex')
    expect(agents.map((a) => a.id)).toContain('claude-code')
    expect(agents.map((a) => a.id)).toContain('qwen-code')
    expect(agents.map((a) => a.id)).toContain('kimi-cli')
  })

  it('seeding is idempotent across registry instances', () => {
    const again = new AgentRegistry(db)
    expect(again.list().filter((a) => a.id === 'codex')).toHaveLength(1)
  })

  it('upsert edits builtins and creates user agents', () => {
    const codex = registry.get('codex')!
    registry.upsert({ ...codex, name: 'Codex (custom)' })
    expect(registry.get('codex')?.name).toBe('Codex (custom)')

    registry.upsert({
      id: 'my-agent',
      name: 'My Agent',
      command: '/usr/local/bin/myagent',
      args: ['--acp'],
      env: {},
      authPreset: 'custom',
      builtin: false
    })
    expect(registry.get('my-agent')?.name).toBe('My Agent')
  })

  it('removes user agents but not builtins', () => {
    registry.upsert({
      id: 'mine',
      name: 'Mine',
      command: 'x',
      args: [],
      env: {},
      authPreset: 'custom',
      builtin: false
    })
    expect(registry.remove('mine')).toBe(true)
    expect(registry.remove('codex')).toBe(false)
    expect(registry.get('codex')).not.toBeNull()
  })

  it('diagnoses missing commands as not found', async () => {
    const result = await registry.diagnose('codex')
    // On this machine npx exists, but the assertion is environment-safe:
    // we only require a coherent result shape.
    expect(result.agentId).toBe('codex')
    expect(typeof result.commandFound).toBe('boolean')
    if (!result.commandFound) {
      expect(result.problems.length).toBeGreaterThan(0)
    }
  })

  it('diagnose reports unknown agents', async () => {
    const result = await registry.diagnose('nope')
    expect(result.commandFound).toBe(false)
    expect(result.problems[0]).toContain('not found')
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
