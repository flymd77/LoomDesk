import type { DbHandle } from './db'

/**
 * Workflow store: canonical persistence for Plan → Execute → Verify
 * runs. The state model is deliberately small —
 *
 *   workflow_runs   one goal + one verify command
 *   workflow_nodes  fixed three nodes per run (plan / execute / verify)
 *   workflow_attempts  each agent interaction within a node
 *
 * Status transitions are validated here so no caller can invent an
 * illegal flow; the fixed pipeline never becomes a DAG.
 */

export type WorkflowRunStatus =
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'cancelled'

export type WorkflowNodeKind = 'plan' | 'execute' | 'verify'

export type WorkflowNodeStatus = 'pending' | 'active' | 'passed' | 'failed' | 'skipped'

/** Legal run status transitions (fixed pipeline). */
const RUN_TRANSITIONS: Record<WorkflowRunStatus, WorkflowRunStatus[]> = {
  planning: ['executing', 'failed', 'cancelled'],
  executing: ['verifying', 'failed', 'cancelled'],
  verifying: ['passed', 'failed', 'cancelled'],
  passed: [],
  failed: [],
  cancelled: []
}

export interface WorkflowRun {
  id: string
  agentId: string
  workspacePath: string
  title: string
  goal: string
  verifyCommand: string
  status: WorkflowRunStatus
  createdAt: number
  updatedAt: number
}

export interface WorkflowNode {
  id: number
  runId: string
  kind: WorkflowNodeKind
  status: WorkflowNodeStatus
  startedAt: number | null
  finishedAt: number | null
  summary: string
  createdAt: number
}

export interface WorkflowAttempt {
  id: number
  nodeId: number
  sessionId: string | null
  prompt: string
  result: string
  exitCode: number | null
  createdAt: number
}

export class WorkflowStore {
  constructor(private readonly db: DbHandle) {}

  /** Create a run with its three pending nodes. */
  create(params: {
    id: string
    agentId: string
    workspacePath: string
    title: string
    goal: string
    verifyCommand: string
  }): WorkflowRun {
    const now = Date.now()
    this.db.db
      .prepare(
        `INSERT INTO workflow_runs (id, agent_id, workspace_path, title, goal, verify_command, status, created_at, updated_at)
         VALUES (@id, @agentId, @workspacePath, @title, @goal, @verifyCommand, 'planning', @now, @now)`
      )
      .run({ ...params, now })
    const insertNode = this.db.db
      .prepare(
        `INSERT INTO workflow_nodes (run_id, kind, status, created_at)
         VALUES (?, ?, 'pending', ?)`
      )
    for (const kind of ['plan', 'execute', 'verify'] as WorkflowNodeKind[]) {
      insertNode.run(params.id, kind, now)
    }
    return this.getRun(params.id) as WorkflowRun
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.db
      .prepare(`SELECT * FROM workflow_runs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    return row ? rowToRun(row) : null
  }

  /** Runs newest first, deterministically (rowid tiebreak). */
  listRuns(limit = 100): WorkflowRun[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM workflow_runs ORDER BY updated_at DESC, rowid DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>
    return rows.map(rowToRun)
  }

  /** Transition a run's status; throws on illegal flow. */
  updateRunStatus(id: string, next: WorkflowRunStatus): void {
    const run = this.getRun(id)
    if (!run) throw new Error(`workflow run '${id}' not found`)
    if (run.status === next) return
    const allowed = RUN_TRANSITIONS[run.status]
    if (!allowed.includes(next)) {
      throw new Error(`illegal run transition: '${run.status}' -> '${next}'`)
    }
    this.db.db
      .prepare(`UPDATE workflow_runs SET status = ?, updated_at = ? WHERE id = ?`)
      .run(next, Date.now(), id)
  }

  /** All nodes of a run, in pipeline order (plan, execute, verify). */
  nodes(runId: string): WorkflowNode[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM workflow_nodes WHERE run_id = ? ORDER BY id`)
      .all(runId) as Array<Record<string, unknown>>
    return rows.map(rowToNode)
  }

  /** Node by kind (single node per kind per run). */
  nodeByKind(runId: string, kind: WorkflowNodeKind): WorkflowNode | null {
    const row = this.db.db
      .prepare(`SELECT * FROM workflow_nodes WHERE run_id = ? AND kind = ?`)
      .get(runId, kind) as Record<string, unknown> | undefined
    return row ? rowToNode(row) : null
  }

  /** Mark a node active (started) — only from pending. */
  startNode(nodeId: number): void {
    this.db.db
      .prepare(
        `UPDATE workflow_nodes SET status = 'active', started_at = ? WHERE id = ? AND status = 'pending'`
      )
      .run(Date.now(), nodeId)
  }

  /** Finish a node with an outcome summary. */
  finishNode(nodeId: number, status: 'passed' | 'failed' | 'skipped', summary = ''): void {
    this.db.db
      .prepare(
        `UPDATE workflow_nodes SET status = ?, finished_at = ?, summary = ? WHERE id = ? AND status = 'active'`
      )
      .run(status, Date.now(), summary, nodeId)
  }

  /** Record one attempt (agent interaction) within a node. */
  addAttempt(params: {
    nodeId: number
    sessionId: string | null
    prompt: string
    result?: string
    exitCode?: number | null
  }): number {
    const info = this.db.db
      .prepare(
        `INSERT INTO workflow_attempts (node_id, session_id, prompt, result, exit_code, created_at)
         VALUES (@nodeId, @sessionId, @prompt, @result, @exitCode, @now)`
      )
      .run({ result: '', exitCode: null, ...params, now: Date.now() })
    return Number(info.lastInsertRowid)
  }

  /** Fill in an attempt's outcome after the agent responds. */
  completeAttempt(attemptId: number, result: string, exitCode: number | null = null): void {
    this.db.db
      .prepare(`UPDATE workflow_attempts SET result = ?, exit_code = ? WHERE id = ?`)
      .run(result, exitCode, attemptId)
  }

  /** Attempts of a node, oldest first. */
  attempts(nodeId: number): WorkflowAttempt[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM workflow_attempts WHERE node_id = ? ORDER BY id`)
      .all(nodeId) as Array<Record<string, unknown>>
    return rows.map(rowToAttempt)
  }

  /** Remove a run (nodes and attempts cascade). */
  removeRun(id: string): boolean {
    const info = this.db.db.prepare(`DELETE FROM workflow_runs WHERE id = ?`).run(id)
    return info.changes > 0
  }
}

function rowToRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    workspacePath: row.workspace_path as string,
    title: row.title as string,
    goal: row.goal as string,
    verifyCommand: row.verify_command as string,
    status: row.status as WorkflowRunStatus,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}

function rowToNode(row: Record<string, unknown>): WorkflowNode {
  return {
    id: row.id as number,
    runId: row.run_id as string,
    kind: row.kind as WorkflowNodeKind,
    status: row.status as WorkflowNodeStatus,
    startedAt: (row.started_at as number | null) ?? null,
    finishedAt: (row.finished_at as number | null) ?? null,
    summary: row.summary as string,
    createdAt: row.created_at as number
  }
}

function rowToAttempt(row: Record<string, unknown>): WorkflowAttempt {
  return {
    id: row.id as number,
    nodeId: row.node_id as number,
    sessionId: (row.session_id as string | null) ?? null,
    prompt: row.prompt as string,
    result: row.result as string,
    exitCode: (row.exit_code as number | null) ?? null,
    createdAt: row.created_at as number
  }
}
