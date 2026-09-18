import { randomUUID } from 'node:crypto'
import type { DbHandle } from './db'

/**
 * Canonical session store.
 *
 * Sessions and messages are the single source of truth for the UI;
 * agent-side ACP session ids are linked but never authoritative here.
 * All writes go through this module; no other module issues session SQL.
 */

export type SessionStatus = 'idle' | 'running' | 'waiting_permission' | 'closed'

export interface SessionRecord {
  id: string
  agentId: string
  title: string
  workspacePath: string
  acpSessionId: string | null
  status: SessionStatus
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'agent' | 'thought' | 'tool' | 'system'

export interface MessageRecord {
  id: number
  sessionId: string
  role: MessageRole
  /** JSON payload: plain text or a structured update (tool call etc.). */
  content: unknown
  createdAt: number
}

/** Summary shape used by list views (no message bodies). */
export interface SessionSummary {
  id: string
  agentId: string
  title: string
  status: SessionStatus
  updatedAt: number
  messageCount: number
}

export class SessionStore {
  constructor(private readonly db: DbHandle) {}

  create(agentId: string, workspacePath: string, title = ''): SessionRecord {
    const now = Date.now()
    const record: SessionRecord = {
      id: randomUUID(),
      agentId,
      title,
      workspacePath,
      acpSessionId: null,
      status: 'idle',
      createdAt: now,
      updatedAt: now
    }
    this.db.db
      .prepare(`
        INSERT INTO sessions (id, agent_id, title, workspace_path, acp_session_id, status, created_at, updated_at)
        VALUES (@id, @agentId, @title, @workspacePath, @acpSessionId, @status, @createdAt, @updatedAt)
      `)
      .run({
        ...record,
        acpSessionId: record.acpSessionId
      })
    return record
  }

  get(id: string): SessionRecord | null {
    const row = this.db.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? rowToSession(row) : null
  }

  list(limit = 100): SessionSummary[] {
    const rows = this.db.db
      .prepare(`
        SELECT s.*, COUNT(m.id) AS message_count
        FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        LIMIT ?
      `)
      .all(limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: row.id as string,
      agentId: row.agent_id as string,
      title: row.title as string,
      status: row.status as SessionStatus,
      updatedAt: row.updated_at as number,
      messageCount: row.message_count as number
    }))
  }

  updateStatus(id: string, status: SessionStatus): void {
    this.db.db
      .prepare(`UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, Date.now(), id)
  }

  /** Link the agent-side ACP session id (after session/new or session/load). */
  linkAcpSession(id: string, acpSessionId: string): void {
    this.db.db
      .prepare(`UPDATE sessions SET acp_session_id = ?, updated_at = ? WHERE id = ?`)
      .run(acpSessionId, Date.now(), id)
  }

  setTitle(id: string, title: string): void {
    this.db.db
      .prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, Date.now(), id)
  }

  appendMessage(sessionId: string, role: MessageRole, content: unknown): MessageRecord {
    const now = Date.now()
    const info = this.db.db
      .prepare(`INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`)
      .run(sessionId, role, JSON.stringify(content), now)
    // Touch the session so list ordering reflects activity.
    this.db.db
      .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
      .run(now, sessionId)
    return {
      id: Number(info.lastInsertRowid),
      sessionId,
      role,
      content,
      createdAt: now
    }
  }

  /** Paged message history for one session (ascending by id). */
  messages(sessionId: string, beforeId?: number, limit = 200): MessageRecord[] {
    const rows = (
      beforeId !== undefined
        ? this.db.db
            .prepare(
              `SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?`
            )
            .all(sessionId, beforeId, limit)
        : this.db.db
            .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?`)
            .all(sessionId, limit)
    ) as Array<Record<string, unknown>>
    return rows
      .map(rowToMessage)
      .reverse() // ascending for display
  }

  /** Delete a session and (via FK cascade) its messages. */
  remove(id: string): boolean {
    const info = this.db.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
    return info.changes > 0
  }
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    title: row.title as string,
    workspacePath: row.workspace_path as string,
    acpSessionId: (row.acp_session_id as string | null) ?? null,
    status: row.status as SessionStatus,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}

function rowToMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: row.id as number,
    sessionId: row.session_id as string,
    role: row.role as MessageRole,
    content: JSON.parse(row.content as string),
    createdAt: row.created_at as number
  }
}
