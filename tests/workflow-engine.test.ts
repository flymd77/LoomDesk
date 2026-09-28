import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeCachedDatabase, openDatabase, type DbHandle } from '../src/main/store/db'
import { AgentRegistry } from '../src/main/agents/registry'
import { SessionStore } from '../src/main/store/sessions'
import { WorkflowStore } from '../src/main/store/workflows'
import { SessionService } from '../src/main/sessions/service'
import { WorkflowEngine } from '../src/main/workflow/engine'

/**
 * Workflow engine tests run the full pipeline against a scripted fake
 * agent (plan/execute turns) and real shell commands (verify). The
 * verify node outcome must track the exit code, not agent text.
 */

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

// Fake agent: first prompt -> "PLAN: ...", second -> "DONE: ...".
const FAKE_AGENT = `
let buffer = '';
let turn = 0;
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buffer += c;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });
    else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'wf-1' } });
    else if (msg.method === 'session/prompt') {
      turn += 1;
      const sid = msg.params.sessionId;
      const text = turn === 1 ? 'PLAN: step one, step two' : 'DONE: implemented';
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: text } } } });
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
    }
  }
});
`

let dir: string
let db: DbHandle
let agents: AgentRegistry
let sessions: SessionStore
let workflows: WorkflowStore
let service: SessionService
let engine: WorkflowEngine

beforeEach(() => {
  closeCachedDatabase()
  dir = mkdtempSync(join(tmpdir(), 'loomdesk-wfe-'))
  db = openDatabase(dir)
  agents = new AgentRegistry(db)
  sessions = new SessionStore(db)
  workflows = new WorkflowStore(db)
  service = new SessionService(sessions, agents)
  engine = new WorkflowEngine(workflows, sessions, service)

  // Point codex at our scripted fake.
  agents.upsert({
    id: 'codex',
    name: 'Codex',
    command: process.execPath,
    args: ['-e', FAKE_AGENT],
    env: {},
    authPreset: 'codex-login',
    builtin: true
  })
})

afterEach(async () => {
  for (const id of service.liveSessionIds()) {
    await service.dispose(id)
  }
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeRun(verifyCommand: string): ReturnType<WorkflowEngine['create']> {
  return engine.create({
    agentId: 'codex',
    workspacePath: tmpdir(),
    title: 'wf test',
    goal: 'make it work',
    verifyCommand
  })
}

describe('WorkflowEngine', () => {
  it('runs the full pipeline to passed when verify exits 0', async () => {
    const run = makeRun('exit 0')
    await engine.start(run.id)

    const final = workflows.getRun(run.id)
    expect(final?.status).toBe('passed')

    const nodes = workflows.nodes(run.id)
    expect(nodes.map((n) => n.status)).toEqual(['passed', 'passed', 'passed'])
    expect(nodes[0].summary).toContain('PLAN')
    expect(nodes[1].summary).toContain('DONE')

    // Verify attempt records the real exit code.
    const verifyAttempts = workflows.attempts(nodes[2].id)
    expect(verifyAttempts).toHaveLength(1)
    expect(verifyAttempts[0].exitCode).toBe(0)
  })

  it('fails the run when verify exits non-zero', async () => {
    const run = makeRun('echo bad >&2; exit 3')
    await engine.start(run.id)

    expect(workflows.getRun(run.id)?.status).toBe('failed')
    const verifyNode = workflows.nodes(run.id)[2]
    expect(verifyNode.status).toBe('failed')
    const attempt = workflows.attempts(verifyNode.id)[0]
    expect(attempt.exitCode).toBe(3)
    expect(attempt.result).toContain('bad')
  })

  it('plan and execute attempts record prompts and agent answers', async () => {
    const run = makeRun('exit 0')
    await engine.start(run.id)

    const nodes = workflows.nodes(run.id)
    const planAttempt = workflows.attempts(nodes[0].id)[0]
    expect(planAttempt.prompt).toContain('step-by-step plan')
    expect(planAttempt.result).toContain('PLAN')

    const execAttempt = workflows.attempts(nodes[1].id)[0]
    expect(execAttempt.prompt).toContain('Follow this plan')
    expect(execAttempt.result).toContain('DONE')
  })

  it('releases the agent session when the run finishes', async () => {
    const run = makeRun('exit 0')
    await engine.start(run.id)
    expect(service.liveSessionIds()).toHaveLength(0)
  })

  it('starting a non-planning run is rejected', async () => {
    const run = makeRun('exit 0')
    await engine.start(run.id)
    await expect(engine.start(run.id)).rejects.toThrow(/not startable/)
  })

  it('marks the run failed when the agent cannot start', async () => {
    // Sabotage the agent config after creating the run.
    agents.upsert({
      id: 'codex',
      name: 'Codex',
      command: '/nonexistent-command-xyz',
      args: [],
      env: {},
      authPreset: 'codex-login',
      builtin: true
    })
    const run = makeRun('exit 0')
    await expect(engine.start(run.id)).rejects.toThrow()
    expect(workflows.getRun(run.id)?.status).toBe('failed')
  })
})
