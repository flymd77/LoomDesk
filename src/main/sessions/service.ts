import { BrowserWindow } from 'electron'
import { ChildProcessTransport } from '../acp/transport'
import { AcpClient } from '../acp/client'
import { AcpSession, type SessionNotification, type SessionUpdate } from '../acp/session'
import {
  PermissionBroker,
  type PermissionRequest,
  type PermissionOption
} from '../acp/permission'
import type { AgentRegistry } from '../agents/registry'
import type { SessionStore, MessageRecord } from '../store/sessions'

/**
 * Session orchestrator: binds one canonical session record to one live
 * ACP agent process. This is the only module that owns agent child
 * processes for chat; everything else observes through the store or
 * window events.
 *
 * Lifecycle:
 *   start()   spawn agent + initialize + session/new (or session/load)
 *   prompt()  append user message, send turn, stream updates to windows
 *   stop()    cancel the in-flight turn
 *   dispose() end the session and kill the process
 *
 * Streamed updates are persisted as messages and broadcast to all
 * BrowserWindows via 'loomdesk:session-event'.
 */

export interface SessionEvent {
  type: 'message' | 'status' | 'permission'
  sessionId: string
  payload: unknown
}

/** Live handle for a running session. */
interface LiveSession {
  transport: ChildProcessTransport
  client: AcpClient
  broker: PermissionBroker
  acp: AcpSession | null
}

export class SessionService {
  private readonly live = new Map<string, LiveSession>()
  /** External observers of status transitions (e.g. notifications). */
  private statusListeners = new Set<(sessionId: string, status: string) => void>()
  /**
   * Remote approval resolver: when set, 'ask' policy permission
   * requests are routed to it (e.g. a Feishu approval card) instead of
   * failing closed. Session-scoped waiting_permission status flows
   * through the status listeners.
   */
  private remoteApproval: ((request: PermissionRequest) => Promise<PermissionOption>) | null = null

  constructor(
    private readonly sessions: SessionStore,
    private readonly agents: AgentRegistry
  ) {}

  /** Install the remote (IM) approval resolver. */
  setRemoteApproval(
    resolver: ((request: PermissionRequest) => Promise<PermissionOption>) | null
  ): void {
    this.remoteApproval = resolver
  }

  /** Register a callback fired after every status transition. */
  onStatus(listener: (sessionId: string, status: string) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private notifyStatus(sessionId: string, status: string): void {
    for (const listener of this.statusListeners) {
      try {
        listener(sessionId, status)
      } catch (err) {
        console.error('[sessions] status listener failed:', err)
      }
    }
  }

  /** Sessions currently holding a live agent process. */
  liveSessionIds(): string[] {
    return [...this.live.keys()]
  }

  /**
   * Bring a session online. Resumes the agent-side session when the
   * record already carries an acpSessionId; otherwise creates a new one.
   */
  async start(sessionId: string): Promise<void> {
    if (this.live.has(sessionId)) return
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error(`session '${sessionId}' not found`)
    const agent = this.agents.get(record.agentId)
    if (!agent) throw new Error(`agent '${record.agentId}' not found`)

    const transport = new ChildProcessTransport({
      command: agent.command,
      args: agent.args,
      env: agent.env,
      cwd: record.workspacePath
    })
    const client = new AcpClient(transport)
    const broker = new PermissionBroker(client)
    // Resolver wiring: a remote (IM) approval service takes priority —
    // the human answers from the phone. Without one, requests fail
    // closed until a local UI resolver is installed.
    broker.setResolver(async (request) => {
      this.sessions.updateStatus(sessionId, 'waiting_permission')
      this.emit(sessionId, 'status', { status: 'waiting_permission' })
      this.notifyStatus(sessionId, 'waiting_permission')
      try {
        const remote = this.remoteApproval
        if (remote) {
          return await remote(request)
        }
        throw new Error('no permission resolver available')
      } finally {
        this.sessions.updateStatus(sessionId, 'idle')
        this.emit(sessionId, 'status', { status: 'idle' })
        this.notifyStatus(sessionId, 'idle')
      }
    })
    broker.attach()

    const live: LiveSession = { transport, client, broker, acp: null }
    this.live.set(sessionId, live)

    // Route session updates into the store and the windows. The wire
    // payload is { sessionId, update }; unwrap and verify the session.
    client.onNotification('session/update', (params) => {
      const notification = params as SessionNotification
      if (
        !notification ||
        typeof notification !== 'object' ||
        notification.sessionId !== live.acp?.id
      ) {
        return
      }
      const update = notification.update as SessionUpdate
      if (!update || typeof update !== 'object') return
      this.persistUpdate(sessionId, update)
    })

    try {
      await client.startAndInitialize({
        protocolVersion: 1,
        clientName: 'LoomDesk',
        clientVersion: '0.1.0'
      })
      if (record.acpSessionId) {
        live.acp = await AcpSession.load(client, record.acpSessionId, record.workspacePath)
      } else {
        live.acp = await AcpSession.create(client, record.workspacePath)
        this.sessions.linkAcpSession(sessionId, live.acp.id)
      }
      this.sessions.updateStatus(sessionId, 'idle')
      this.emit(sessionId, 'status', { status: 'idle' })
      this.notifyStatus(sessionId, 'idle')
    } catch (err) {
      this.live.delete(sessionId)
      transport.close({ force: true })
      throw err
    }
  }

  /**
   * Send one user turn. Resolves when the agent finishes the turn
   * (stop reason received). Messages are persisted as they stream.
   */
  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    const live = this.live.get(sessionId)
    if (!live?.acp) throw new Error(`session '${sessionId}' is not online`)

    this.sessions.appendMessage(sessionId, 'user', { text })
    this.emit(sessionId, 'message', { role: 'user', content: { text } })
    this.sessions.updateStatus(sessionId, 'running')
    this.emit(sessionId, 'status', { status: 'running' })
    this.notifyStatus(sessionId, 'running')

    try {
      const result = await live.acp.prompt([{ type: 'text', text }])
      return result
    } finally {
      this.sessions.updateStatus(sessionId, 'idle')
      this.emit(sessionId, 'status', { status: 'idle' })
      this.notifyStatus(sessionId, 'idle')
    }
  }

  /** Request cancellation of the in-flight turn (notification). */
  stop(sessionId: string): void {
    this.live.get(sessionId)?.acp?.cancel()
  }

  /**
   * Tear the session down: kill the agent process. The canonical
   * record (and its acpSessionId) survives for later resume.
   */
  async dispose(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId)
    if (!live) return
    this.live.delete(sessionId)
    live.transport.close({ force: true })
    this.sessions.updateStatus(sessionId, 'closed')
    this.emit(sessionId, 'status', { status: 'closed' })
    this.notifyStatus(sessionId, 'closed')
  }

  /** Messages for a session, paged (renderer supply beforeId cursor). */
  history(sessionId: string, beforeId?: number, limit = 200): MessageRecord[] {
    return this.sessions.messages(sessionId, beforeId, limit)
  }

  /** Persist one streamed update as a message row. */
  private persistUpdate(sessionId: string, update: SessionUpdate): void {
    const kind = update.sessionUpdate
    if (kind === 'agent_message_chunk') {
      const text = AcpSession.textOf(update)
      if (text) {
        this.sessions.appendMessage(sessionId, 'agent', { text })
        this.emit(sessionId, 'message', { role: 'agent', content: { text } })
      }
    } else if (kind === 'agent_thought_chunk') {
      const text = AcpSession.textOf(update)
      if (text) {
        this.sessions.appendMessage(sessionId, 'thought', { text })
        this.emit(sessionId, 'message', { role: 'thought', content: { text } })
      }
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      this.sessions.appendMessage(sessionId, 'tool', update)
      this.emit(sessionId, 'message', { role: 'tool', content: update })
    } else if (kind === 'plan') {
      this.sessions.appendMessage(sessionId, 'system', update)
      this.emit(sessionId, 'message', { role: 'system', content: update })
    }
    // Unknown kinds are intentionally not persisted: they carry no
    // display semantics yet. Extending persistence is additive.
  }

  /** Broadcast one event to all windows. */
  private emit(sessionId: string, type: SessionEvent['type'], payload: unknown): void {
    const event: SessionEvent = { type, sessionId, payload }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('loomdesk:session-event', event)
      }
    }
  }
}
