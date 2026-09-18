import type { AgentConfig } from './types'

/**
 * Built-in agent presets. Codex is always listed first per product
 * convention; the rest follow support maturity from the research doc
 * (docs/research/acp-support-matrix.md).
 *
 * Adapter-wrapped agents (codex-acp, claude-code-acp) run through npx;
 * native ACP agents expose their own flags.
 */
export const BUILTIN_AGENTS: AgentConfig[] = [
  {
    id: 'codex',
    name: 'Codex',
    command: 'npx',
    args: ['@agentclientprotocol/codex-acp'],
    env: {},
    authPreset: 'codex-login',
    builtin: true
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'npx',
    args: ['@zed-industries/claude-code-acp'],
    env: {},
    authPreset: 'claude-subscription',
    builtin: true
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    command: 'qwen',
    args: ['--experimental-acp'],
    env: {},
    authPreset: 'qwen-oauth',
    builtin: true
  },
  {
    id: 'kimi-cli',
    name: 'Kimi CLI',
    command: 'kimi',
    args: ['acp'],
    env: {},
    authPreset: 'kimi-login',
    builtin: true
  }
]
