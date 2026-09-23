import type { AgentAuthPreset } from './types'

/**
 * Install/setup guidance for built-in agents, tuned for users behind
 * mainland-China networks: npm mirrors, CN-friendly endpoints and
 * proxy notes. LoomDesk never runs these commands itself — the user
 * copies them into their own terminal so nothing surprising happens
 * with global installs or credentials.
 */

export interface SetupStep {
  title: string
  /** Command to run (empty for pure-informational steps). */
  command?: string
  detail?: string
}

export interface AgentSetupGuide {
  agentId: string
  /** npm package name when the CLI installs via npm. */
  npmPackage?: string
  steps: SetupStep[]
  /** Environment variables this CLI typically needs (proxy etc). */
  notes: string[]
}

/** npm registry mirror used across guides (configurable at runtime). */
export const NPM_MIRROR = 'https://registry.npmmirror.com'

export const SETUP_GUIDES: Record<string, AgentSetupGuide> = {
  codex: {
    agentId: 'codex',
    npmPackage: '@openai/codex',
    steps: [
      {
        title: 'Install the Codex CLI',
        command: `npm install -g @openai/codex --registry=${NPM_MIRROR}`,
        detail: 'Global install; requires Node.js 22+.'
      },
      {
        title: 'Log in',
        command: 'codex login',
        detail: 'ChatGPT account or an OpenAI API key. A proxy is usually required to reach OpenAI from mainland networks.'
      },
      {
        title: 'Verify ACP adapter availability',
        command: 'npx @agentclientprotocol/codex-acp --version',
        detail: 'LoomDesk talks to Codex through this adapter; it is fetched on first run.'
      }
    ],
    notes: [
      'If login or chat fails with network errors, export https_proxy / http_proxy before starting LoomDesk — agent processes inherit them.',
      'For the ACP adapter, the registry mirror matters only at download time; runtime traffic goes to OpenAI and needs the proxy.'
    ]
  },
  'claude-code': {
    agentId: 'claude-code',
    npmPackage: '@zed-industries/claude-code-acp',
    steps: [
      {
        title: 'Log in with Claude Code',
        command: 'claude login',
        detail: 'Subscription (Pro/Max) or an Anthropic API key.'
      },
      {
        title: 'Verify the ACP adapter',
        command: 'npx @zed-industries/claude-code-acp --version',
        detail: 'Adapter is fetched through npm on first run; the mirror registry speeds this up.'
      }
    ],
    notes: [
      'Set https_proxy before launching LoomDesk when Anthropic endpoints are unreachable directly.'
    ]
  },
  'qwen-code': {
    agentId: 'qwen-code',
    npmPackage: '@qwen-code/qwen-code',
    steps: [
      {
        title: 'Install Qwen Code',
        command: `npm install -g @qwen-code/qwen-code --registry=${NPM_MIRROR}`,
        detail: 'Requires Node.js 20+.'
      },
      {
        title: 'Start and authorize',
        command: 'qwen',
        detail: 'Qwen OAuth opens the browser on first run; a free tier is available with a CN-friendly endpoint.'
      }
    ],
    notes: [
      'Qwen endpoints are reachable from mainland networks without a proxy in most regions.'
    ]
  },
  'kimi-cli': {
    agentId: 'kimi-cli',
    npmPackage: '@moonshot-ai/kimi-cli',
    steps: [
      {
        title: 'Install Kimi CLI',
        command: `npm install -g @moonshot-ai/kimi-cli --registry=${NPM_MIRROR}`,
        detail: 'Or install with uv: uv tool install --python 3.13 kimi-cli'
      },
      {
        title: 'Log in',
        command: 'kimi login',
        detail: 'Moonshot account; CN endpoints, no proxy required.'
      }
    ],
    notes: ['Kimi runs on Moonshot infrastructure reachable from mainland networks.']
  }
}

/** Auth preset -> human-readable login description (for custom agents). */
export const AUTH_LABELS: Record<AgentAuthPreset, string> = {
  'codex-login': 'Codex login (ChatGPT account or OpenAI API key)',
  'claude-subscription': 'Claude subscription or Anthropic API key',
  'qwen-oauth': 'Qwen OAuth (browser flow on first run)',
  'kimi-login': 'Moonshot account login',
  custom: 'User-managed authentication'
}
