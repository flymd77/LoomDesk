/**
 * Agent configuration model.
 *
 * An agent is a local coding CLI we spawn and speak ACP with. The
 * config maps 1:1 to what we pass to ChildProcessTransport, plus
 * metadata for the UI and an auth preset describing how the CLI is
 * expected to be authenticated (checked during environment diagnostics).
 */

/** How the CLI is expected to be authenticated on this machine. */
export type AgentAuthPreset =
  | 'codex-login' // Codex: ChatGPT account or API key via `codex login`
  | 'claude-subscription' // Claude Code: subscription or API key
  | 'qwen-oauth' // Qwen Code: Qwen OAuth or API key
  | 'kimi-login' // Kimi CLI: Moonshot account
  | 'custom' // user-managed environment

export interface AgentConfig {
  /** Stable identifier (also used as the storage key). */
  id: string
  /** Display name in the UI. */
  name: string
  /** Executable to spawn ("npx", "codex", "qwen", ...). */
  command: string
  /** Argument list including the ACP flags. */
  args: string[]
  /** Extra environment variables merged over process.env at spawn. */
  env: Record<string, string>
  /** Auth expectation for environment diagnostics. */
  authPreset: AgentAuthPreset
  /** Whether this agent entry is built-in (Codex etc.) or user-added. */
  builtin: boolean
}

/** Result of checking whether an agent can actually run on this machine. */
export interface AgentDiagnostics {
  agentId: string
  /** Binary resolvable on PATH? */
  commandFound: boolean
  /** Resolved absolute path when found. */
  commandPath?: string
  /** Version string when the CLI supports --version (best effort). */
  version?: string
  /** Auth-specific check passed? (null when not checkable) */
  authOk: boolean | null
  /** Human-readable problem summary when something is off. */
  problems: string[]
}
