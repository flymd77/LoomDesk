/**
 * IPC contract shared between main, preload and renderer.
 * Channel names and payload types; keep in sync with src/main/ipc.ts.
 */

export interface AppInfo {
  name: string
  version: string
  platform: string
  electronVersion: string
  nodeVersion: string
}

/** Agent config as exposed to the renderer (subset is fine). */
export interface AgentConfigDto {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  authPreset: string
  builtin: boolean
}

export interface AgentDiagnosticsDto {
  agentId: string
  commandFound: boolean
  commandPath?: string
  version?: string
  authOk: boolean | null
  problems: string[]
}

export interface SessionSummaryDto {
  id: string
  agentId: string
  title: string
  status: 'idle' | 'running' | 'waiting_permission' | 'closed'
  updatedAt: number
  messageCount: number
}

export interface SessionRecordDto {
  id: string
  agentId: string
  title: string
  workspacePath: string
  acpSessionId: string | null
  status: SessionSummaryDto['status']
  createdAt: number
  updatedAt: number
}

export interface MessageDto {
  id: number
  sessionId: string
  role: 'user' | 'agent' | 'thought' | 'tool' | 'system'
  content: unknown
  createdAt: number
}

/** Text block shape inside streamed content (ACP content blocks). */
export interface TextBlock {
  type: 'text'
  text: string
}

/** Tool call update as streamed by the agent (subset used for display). */
export interface ToolCallUpdate {
  sessionUpdate: 'tool_call' | 'tool_call_update'
  toolCallId: string
  title?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'failed'
}

/** Payload of a 'message' session event. */
export interface MessageEventPayload {
  role: MessageDto['role']
  content: unknown
}

/** Payload of a 'status' session event. */
export interface StatusEventPayload {
  status: SessionSummaryDto['status']
}

/** Pushed from main to renderer on session activity. */
export interface SessionEventDto {
  type: 'message' | 'status' | 'permission'
  sessionId: string
  payload: unknown
}

/** The full API surface exposed on window.loomdesk by the preload. */
export interface LoomDeskApi {
  getAppInfo(): Promise<AppInfo>
  // agents
  listAgents(): Promise<AgentConfigDto[]>
  diagnoseAgent(agentId: string): Promise<AgentDiagnosticsDto>
  // sessions
  createSession(params: {
    agentId: string
    workspacePath: string
    title?: string
  }): Promise<SessionRecordDto>
  listSessions(limit?: number): Promise<SessionSummaryDto[]>
  getSession(id: string): Promise<SessionRecordDto | null>
  removeSession(id: string): Promise<boolean>
  history(id: string, beforeId?: number, limit?: number): Promise<MessageDto[]>
  startSession(id: string): Promise<boolean>
  promptSession(id: string, text: string): Promise<{ stopReason: string }>
  stopSession(id: string): Promise<boolean>
  disposeSession(id: string): Promise<boolean>
  // push events
  onSessionEvent(handler: (event: SessionEventDto) => void): () => void
}
