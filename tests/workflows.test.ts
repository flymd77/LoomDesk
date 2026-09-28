import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeCachedDatabase, openDatabase, type DbHandle } from '../src/main/store/db'
import { AgentRegistry } from '../src/main/agents/registry'
import { SessionStore } from '../src/main/store/sessions'
import { WorkflowStore } from '../src/main/store/workflows'

/**
 * Workflow store tests: three-table model, fixed pipeline creation,
 * legal-transition enforcement, attempt bookkeeping and cascade
 * deletion.
 */

let dir: string
let db: DbHandle
let workflows: WorkflowStore

beforeEach(() => {
  closeCachedDatabase()
  dir = mkdtempSync(join(tmpdir(), 'loomdesk-wf-'))
  db = openDatabase(dir)
  new AgentRegistry(db) // seed builtins (FK target for agent_id)
  new SessionStore(db) // sessions table (FK target for attempts)
  workflows = new WorkflowStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeRun(overrides: Record<string, string> = {}): ReturnType<WorkflowStore['create']> {
  return workflows.create({
    id: 'run-1',
    agentId: 'codex',
    workspacePath: '/tmp',
    title: 'Add a feature',
    goal: 'Add a health check endpoint',
    verifyCommand: 'npm test',
    ...overrides
  })
}

describe('WorkflowStore', () => {
  it('creates a run with three pending nodes in pipeline order', () => {
    const run = makeRun()
    expect(run.status).toBe('planning')

    const nodes = workflows.nodes(run.id)
    expect(nodes.map((n) => n.kind)).toEqual(['plan', 'execute', 'verify'])
    expect(nodes.every((n) => n.status === 'pending')).toBe(true)
  })

  it('round-trips run fields and lists newest first', () => {
    makeRun()
    const later = makeRun({ id: 'run-2', title: 'Second' })

    const listed = workflows.listRuns()
    expect(listed).toHaveLength(2)
    expect(listed[0].id).toBe(later.id)
    expect(listed[0].goal).toBe('Add a health check endpoint')
    expect(listed[0].verifyCommand).toBe('npm test')
  })

  it('persists across reopen', () => {
    makeRun()
    db.close()
    db = openDatabase(dir)
    workflows = new WorkflowStore(db)
    const run = workflows.getRun('run-1')
    expect(run?.status).toBe('planning')
    expect(workflows.nodes('run-1')).toHaveLength(3)
  })

  it('enforces the fixed pipeline transitions', () => {
    const run = makeRun()

    // planning -> verifying is illegal (must pass through executing)
    expect(() => workflows.updateRunStatus(run.id, 'verifying')).toThrow(/illegal/)
    // terminal states are dead ends
    workflows.updateRunStatus(run.id, 'cancelled')
    expect(() => workflows.updateRunStatus(run.id, 'executing')).toThrow(/illegal/)

    const other = makeRun({ id: 'run-3' })
    workflows.updateRunStatus(other.id, 'executing')
    workflows.updateRunStatus(other.id, 'verifying')
    workflows.updateRunStatus(other.id, 'passed')
    expect(workflows.getRun(other.id)?.status).toBe('passed')
  })

  it('nodes start from pending and finish from active only', () => {
    const run = makeRun()
    const plan = workflows.nodeByKind(run.id, 'plan')!

    // finishing a pending node is a no-op (must start first)
    workflows.finishNode(plan.id, 'passed', 'done')
    expect(workflows.nodeByKind(run.id, 'plan')?.status).toBe('pending')

    workflows.startNode(plan.id)
    expect(workflows.nodeByKind(run.id, 'plan')?.status).toBe('active')

    workflows.finishNode(plan.id, 'passed', 'three steps planned')
    const done = workflows.nodeByKind(run.id, 'plan')!
    expect(done.status).toBe('passed')
    expect(done.summary).toBe('three steps planned')
    expect(done.finishedAt).not.toBeNull()
  })

  it('records attempts with prompts, results and exit codes', () => {
    const sessions = new SessionStore(db)
    const session = sessions.create('codex', '/tmp', 'wf-chat')

    const run = makeRun()
    const verify = workflows.nodeByKind(run.id, 'verify')!

    const attemptId = workflows.addAttempt({
      nodeId: verify.id,
      sessionId: session.id,
      prompt: 'npm test'
    })
    workflows.completeAttempt(attemptId, 'all green', 0)

    const attempts = workflows.attempts(verify.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      sessionId: session.id,
      prompt: 'npm test',
      result: 'all green',
      exitCode: 0
    })
  })

  it('deleting a run cascades to nodes and attempts', () => {
    const run = makeRun()
    const plan = workflows.nodeByKind(run.id, 'plan')!
    workflows.addAttempt({ nodeId: plan.id, sessionId: null, prompt: 'plan please' })

    expect(workflows.removeRun(run.id)).toBe(true)
    expect(workflows.getRun(run.id)).toBeNull()
    expect(workflows.nodes(run.id)).toHaveLength(0)
    expect(workflows.attempts(plan.id)).toHaveLength(0)
  })
})
