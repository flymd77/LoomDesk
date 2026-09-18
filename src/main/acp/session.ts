import type { AcpClient } from './client'

/**
 * Typed view of ACP `session/update` notifications.
 *
 * Only the fields LoomDesk consumes are declared; unknown fields are
 * passed through untouched so we never lose agent-specific extensions.
 * Spec: https://agentclientprotocol.com/protocol/v1/prompt-turn
 */

/** One content block inside an agent message or user message. */
export interface SessionContentBlock {
  type: string // 'text' | 'image' | 'audio' | 'resource_link' | ...
  text?: string
  // Other block variants pass through untyped.
  [key: string]: unknown
}

/** Base shape every session update carries. */
export interface SessionUpdateBase {
  sessionUpdate: string
  [key: string]: unknown
}

/** update kinds we explicitly care about today. */
export interface AgentMessageUpdate extends SessionUpdateBase {
  sessionUpdate: 'agent_message_chunk'
  content: SessionContentBlock
}

export interface AgentThoughtUpdate extends SessionUpdateBase {
  sessionUpdate: 'agent_thought_chunk'
  content: SessionContentBlock
}

export interface ToolCallUpdate extends SessionUpdateBase {
  sessionUpdate: 'tool_call'
  toolCallId: string
  title?: string
  kind?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'failed'
  content?: SessionContentBlock[]
  locations?: Array<Record<string, unknown>>
  rawInput?: unknown
  rawOutput?: unknown
}

export interface ToolCallUpdateDelta extends SessionUpdateBase {
  sessionUpdate: 'tool_call_update'
  toolCallId: string
  // Partial fields; only changed ones are present.
  [key: string]: unknown
}

export interface PlanUpdate extends SessionUpdateBase {
  sessionUpdate: 'plan'
  entries?: Array<{
    content: string
    priority?: string
    status?: string
  }>
}

export type SessionUpdate =
  | AgentMessageUpdate
  | AgentThoughtUpdate
  | ToolCallUpdate
  | ToolCallUpdateDelta
  | PlanUpdate
  | SessionUpdateBase

/** Result of a completed prompt turn. */
export interface StopReason {
  /** 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' */
  stopReason: string
  [key: string]: unknown
}

export interface NewSessionResult {
  sessionId: string
  [key: string]: unknown
}

/**
 * Session-scoped helpers bound to one AcpClient.
 * Each method is a thin typed wrapper over the JSON-RPC methods defined
 * by the ACP spec; streaming itself flows through onNotification('session/update').
 */
export class AcpSession {
  constructor(
    private readonly client: AcpClient,
    private readonly sessionId: string
  ) {}

  get id(): string {
    return this.sessionId
  }

  /** `session/new` — create a session bound to a working directory. */
  static async create(
    client: AcpClient,
    cwd: string,
    mcpServers: unknown[] = []
  ): Promise<AcpSession> {
    const result = (await client.request('session/new', { cwd, mcpServers })) as NewSessionResult
    if (typeof result?.sessionId !== 'string' || result.sessionId.length === 0) {
      throw new Error('session/new response missing sessionId')
    }
    return new AcpSession(client, result.sessionId)
  }

  /** `session/load` — resume a previously persisted session. */
  static async load(
    client: AcpClient,
    sessionId: string,
    cwd: string,
    mcpServers: unknown[] = []
  ): Promise<AcpSession> {
    await client.request('session/load', { sessionId, cwd, mcpServers })
    return new AcpSession(client, sessionId)
  }

  /** `session/prompt` — send one user turn; resolves when the turn completes. */
  async prompt(content: SessionContentBlock[]): Promise<StopReason> {
    const result = (await this.client.request('session/prompt', {
      sessionId: this.sessionId,
      content
    })) as StopReason
    if (typeof result?.stopReason !== 'string') {
      throw new Error('session/prompt response missing stopReason')
    }
    return result
  }

  /** `session/cancel` — request cancellation of the in-flight turn (notification). */
  async cancel(): Promise<void> {
    this.client.notify('session/cancel', { sessionId: this.sessionId })
  }

  /**
   * Subscribe to this session's updates. The handler receives every
   * `session/update` notification; filtering by sessionUpdate kind is
   * left to the consumer so unknown kinds are never dropped silently.
   * Returns an unsubscribe function.
   */
  onUpdate(handler: (update: SessionUpdate) => void): () => void {
    return this.client.onNotification('session/update', (params) => {
      const update = params as SessionUpdate
      if (update && typeof update === 'object') {
        handler(update)
      }
    })
  }

  /** Convenience: collect text chunks of one update into display text. */
  static textOf(update: SessionUpdate): string {
    if (
      (update.sessionUpdate === 'agent_message_chunk' ||
        update.sessionUpdate === 'agent_thought_chunk') &&
      typeof (update as AgentMessageUpdate).content?.text === 'string'
    ) {
      return (update as AgentMessageUpdate).content.text as string
    }
    return ''
  }
}
