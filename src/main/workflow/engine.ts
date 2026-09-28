import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { SessionStore } from '../store/sessions'
import type { WorkflowStore, WorkflowRun } from '../store/workflows'
import type { SessionService } from '../sessions/service'

/**
 * Workflow engine: drives the fixed Plan -> Execute -> Verify pipeline
 * over one agent chat session.
 *
 *   plan     ask the agent for a concise written plan; store it as the
 *            node summary and feed it into execution
 *   execute  ask the agent to implement the plan; stopReason recorded
 *   verify   run the user's verify command and trust ONLY its exit
 *            code (agent self-reports are never pass/fail)
 *
 * Every step persists an attempt row before running, so an aborted
 * workflow shows exactly what was asked and what came back. The run
 * status transitions are validated by the store; the engine cannot
 * skip stages.
 */

/** Prompts used for each agent-driven node (plain, model-agnostic). */
const PLAN_PROMPT = (goal: string): string =>
  `You are working toward this goal:\n\n${goal}\n\n` +
  `Write a concise step-by-step plan (max 10 steps) for how you will implement it. ` +
  `Do not implement anything yet. Output only the plan.`

const EXECUTE_PROMPT = (goal: string, plan: string): string =>
  `Work toward this goal:\n\n${goal}\n\n` +
  `Follow this plan:\n\n${plan}\n\n` +
  `Implement it now. When you finish, summarize what changed.`

const VERIFY_TIMEOUT_MS = 10 * 60 * 1000

export class WorkflowEngine {
  /** Runs currently driving (guards double-start). */
  private active = new Set<string>()

  constructor(
    private readonly workflows: WorkflowStore,
    private readonly sessions: SessionStore,
    private readonly service: SessionService
  ) {}

  /** Create a run (persisted, planning state) without starting it. */
  create(params: {
    agentId: string
    workspacePath: string
    title: string
    goal: string
    verifyCommand: string
  }): WorkflowRun {
    return this.workflows.create({ id: randomUUID(), ...params })
  }

  /** Start (or report already-running) a workflow run. */
  async start(runId: string): Promise<void> {
    if (this.active.has(runId)) return
    const run = this.workflows.getRun(runId)
    if (!run) throw new Error(`workflow run '${runId}' not found`)
    if (run.status !== 'planning') throw new Error(`run is '${run.status}', not startable`)

    this.active.add(runId)
    try {
      await this.executePipeline(run)
    } finally {
      this.active.delete(runId)
    }
  }

  /** Cancel: the store only allows cancelling from live states. */
  cancel(runId: string): void {
    const run = this.workflows.getRun(runId)
    if (!run) return
    this.workflows.updateRunStatus(runId, 'cancelled')
  }

  private async executePipeline(run: WorkflowRun): Promise<void> {
    // One chat session carries plan + execute (context continuity).
    const session = this.sessions.create(run.agentId, run.workspacePath, run.title)

    try {
      await this.service.start(session.id)
    } catch (err) {
      this.workflows.updateRunStatus(run.id, 'failed')
      throw err
    }

    try {
      // ---- plan ----
      const planNode = this.workflows.nodeByKind(run.id, 'plan')
      if (!planNode) throw new Error('plan node missing')
      this.workflows.startNode(planNode.id)
      const planAttempt = this.workflows.addAttempt({
        nodeId: planNode.id,
        sessionId: session.id,
        prompt: PLAN_PROMPT(run.goal)
      })
      let plan = ''
      try {
        const stop = await this.service.prompt(session.id, PLAN_PROMPT(run.goal))
        plan = this.collectAgentText(session.id)
        this.workflows.completeAttempt(planAttempt, plan || stop.stopReason)
        this.workflows.finishNode(planNode.id, 'passed', plan.slice(0, 2000))
      } catch (err) {
        this.workflows.completeAttempt(planAttempt, String(err))
        this.workflows.finishNode(planNode.id, 'failed', String(err))
        this.workflows.updateRunStatus(run.id, 'failed')
        return
      }

      // ---- execute ----
      this.workflows.updateRunStatus(run.id, 'executing')
      const execNode = this.workflows.nodeByKind(run.id, 'execute')
      if (!execNode) throw new Error('execute node missing')
      this.workflows.startNode(execNode.id)
      const execAttempt = this.workflows.addAttempt({
        nodeId: execNode.id,
        sessionId: session.id,
        prompt: EXECUTE_PROMPT(run.goal, plan)
      })
      let execSummary = ''
      try {
        const stop = await this.service.prompt(session.id, EXECUTE_PROMPT(run.goal, plan))
        execSummary = this.collectAgentText(session.id)
        this.workflows.completeAttempt(execAttempt, execSummary || stop.stopReason)
        this.workflows.finishNode(execNode.id, 'passed', execSummary.slice(0, 2000))
      } catch (err) {
        this.workflows.completeAttempt(execAttempt, String(err))
        this.workflows.finishNode(execNode.id, 'failed', String(err))
        this.workflows.updateRunStatus(run.id, 'failed')
        return
      }

      // ---- verify (exit code is the only truth) ----
      this.workflows.updateRunStatus(run.id, 'verifying')
      const verifyNode = this.workflows.nodeByKind(run.id, 'verify')
      if (!verifyNode) throw new Error('verify node missing')
      this.workflows.startNode(verifyNode.id)
      const verifyAttempt = this.workflows.addAttempt({
        nodeId: verifyNode.id,
        sessionId: null,
        prompt: run.verifyCommand
      })
      const outcome = await this.runVerifyCommand(run.verifyCommand, run.workspacePath)
      this.workflows.completeAttempt(
        verifyAttempt,
        outcome.output.slice(-2000),
        outcome.code
      )
      if (outcome.code === 0) {
        this.workflows.finishNode(verifyNode.id, 'passed', outcome.output.slice(0, 2000))
        this.workflows.updateRunStatus(run.id, 'passed')
      } else {
        this.workflows.finishNode(verifyNode.id, 'failed', outcome.output.slice(0, 2000))
        this.workflows.updateRunStatus(run.id, 'failed')
      }
    } finally {
      // Release the agent process; the chat record stays for review.
      await this.service.dispose(session.id).catch(() => undefined)
    }
  }

  /** Concatenate the agent's text messages from a session (latest turn). */
  private collectAgentText(sessionId: string): string {
    const messages = this.service.history(sessionId, undefined, 500)
    return messages
      .filter((m) => m.role === 'agent')
      .map((m) => {
        const text = (m.content as { text?: string })?.text
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n')
  }

  /**
   * Run the verify command through the shell in the workspace; the
   * command string is user-authored (same trust level as running it in
   * their own terminal). Resolves with exit code and combined output.
   */
  private runVerifyCommand(
    command: string,
    cwd: string
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve) => {
      execFile(
        '/bin/sh',
        ['-c', command],
        { cwd, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim()
          if (err) {
            const code = (err as NodeJS.ErrnoException & { code?: unknown }).code
            resolve({ code: typeof code === 'number' ? code : 1, output })
          } else {
            resolve({ code: 0, output })
          }
        }
      )
    })
  }
}
