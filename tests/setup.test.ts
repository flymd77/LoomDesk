import { describe, expect, it } from 'vitest'
import { SETUP_GUIDES, NPM_MIRROR, AUTH_LABELS, type AgentSetupGuide } from '../src/main/agents/setup'

/**
 * Setup guide tests: data integrity for every built-in agent. The
 * guides are pure data (no execution), so tests validate shape and
 * invariants — CN mirror usage, copyable commands, notes present.
 */

const BUILTIN_IDS = ['codex', 'claude-code', 'qwen-code', 'kimi-cli']

describe('SETUP_GUIDES', () => {
  it('covers every built-in agent', () => {
    for (const id of BUILTIN_IDS) {
      expect(SETUP_GUIDES[id], `missing guide for ${id}`).toBeDefined()
    }
  })

  it('every guide has ordered steps with non-empty titles', () => {
    for (const [id, guide] of Object.entries(SETUP_GUIDES)) {
      expect(guide.steps.length, `${id} has no steps`).toBeGreaterThan(0)
      for (const step of guide.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('install steps use the CN npm mirror', () => {
    const withInstall = (g: AgentSetupGuide): boolean =>
      g.steps.some((s) => s.command?.includes('npm install -g'))
    for (const [id, guide] of Object.entries(SETUP_GUIDES)) {
      if (withInstall(guide)) {
        expect(
          guide.steps.some((s) => s.command?.includes(NPM_MIRROR)),
          `${id} installs without the mirror registry`
        ).toBe(true)
      }
    }
  })

  it('codex guide comes with proxy notes (mainland networks)', () => {
    expect(SETUP_GUIDES.codex.notes.join(' ')).toMatch(/proxy/i)
  })

  it('auth labels cover every preset key', () => {
    // AUTH_LABELS is typed exhaustively; this guard survives refactors.
    expect(Object.keys(AUTH_LABELS).sort()).toEqual(
      ['claude-subscription', 'codex-login', 'custom', 'kimi-login', 'qwen-oauth'].sort()
    )
  })
})

describe('guide IPC contract shape', () => {
  it('guides serialize to plain JSON (IPC-safe)', () => {
    for (const guide of Object.values(SETUP_GUIDES)) {
      const round = JSON.parse(JSON.stringify(guide)) as AgentSetupGuide
      expect(round).toEqual(guide)
    }
  })
})
