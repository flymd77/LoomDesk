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
  inputTokens: number
  outputTokens: number
  cachedReadTokens: number
  turns: number
}

export interface SessionRecordDto {
  id: string
  agentId: string
  title: string
  workspacePath: string
  acpSessionId: string | null
  status: SessionSummaryDto['status']
  inputTokens: number
  outputTokens: number
  cachedReadTokens: number
  turns: number
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

/** Payload of a 'usage' session event (cumulative session totals). */
export interface UsageEventPayload {
  inputTokens: number
  outputTokens: number
}

/** Pushed from main to renderer on session activity. */
export interface SessionEventDto {
  type: 'message' | 'status' | 'permission' | 'usage'
  sessionId: string
  payload: unknown
}

/** Feishu IM integration settings (stored in the settings table). */
export interface FeishuSettingsDto {
  enabled: boolean
  appId: string
  appSecret: string
  chatId: string
  endpoint: 'feishu' | 'lark'
}

/** One guided setup step for an agent (display only, never executed). */
export interface SetupStepDto {
  title: string
  command?: string
  detail?: string
}

/** Install/setup guidance for one agent. */
export interface AgentSetupGuideDto {
  agentId: string
  npmPackage?: string
  steps: SetupStepDto[]
  notes: string[]
}

/** One Plan -> Execute -> Verify workflow run. */
export interface WorkflowRunDto {
  id: string
  agentId: string
  workspacePath: string
  title: string
  goal: string
  verifyCommand: string
  status: 'planning' | 'executing' | 'verifying' | 'passed' | 'failed' | 'cancelled'
  createdAt: number
  updatedAt: number
}

export interface WorkflowNodeDto {
  id: number
  runId: string
  kind: 'plan' | 'execute' | 'verify'
  status: 'pending' | 'active' | 'passed' | 'failed' | 'skipped'
  startedAt: number | null
  finishedAt: number | null
  summary: string
  createdAt: number
}

export interface WorkflowAttemptDto {
  id: number
  nodeId: number
  sessionId: string | null
  prompt: string
  result: string
  exitCode: number | null
  createdAt: number
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
  // notify (IM settings)
  getFeishuSettings(): Promise<FeishuSettingsDto | null>
  setFeishuSettings(values: Partial<FeishuSettingsDto>): Promise<boolean>
  testFeishu(): Promise<{ ok: boolean; message: string }>
  // agent setup guidance
  getSetupGuide(agentId: string): Promise<AgentSetupGuideDto | null>
  // workflows
  createWorkflow(params: {
    agentId: string
    workspacePath: string
    title: string
    goal: string
    verifyCommand: string
  }): Promise<WorkflowRunDto>
  listWorkflows(limit?: number): Promise<WorkflowRunDto[]>
  getWorkflow(id: string): Promise<WorkflowRunDto | null>
  workflowNodes(id: string): Promise<WorkflowNodeDto[]>
  workflowAttempts(nodeId: number): Promise<WorkflowAttemptDto[]>
  startWorkflow(id: string): Promise<boolean>
  cancelWorkflow(id: string): Promise<boolean>
  removeWorkflow(id: string): Promise<boolean>
}
