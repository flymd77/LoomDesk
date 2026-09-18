import { execFile } from 'node:child_process'
import type { DbHandle } from '../store/db'
import { BUILTIN_AGENTS } from './builtin'
import type { AgentConfig, AgentDiagnostics } from './types'

/**
 * Agent registry: persisted agent configs + environment diagnostics.
 *
 * Built-in presets are seeded once; user edits (including edits to
 * built-ins, e.g. a custom npx registry) are respected afterwards.
 */

function rowToConfig(row: Record<string, unknown>): AgentConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    command: row.command as string,
    args: JSON.parse(row.args as string) as string[],
    env: JSON.parse(row.env as string) as Record<string, string>,
    authPreset: row.auth_preset as AgentConfig['authPreset'],
    builtin: row.builtin === 1
  }
}

export class AgentRegistry {
  constructor(private readonly db: DbHandle) {
    this.seedBuiltins()
  }

  /** Seed built-in agents that are not present yet (insert-only). */
  private seedBuiltins(): void {
    const insert = this.db.db.prepare(`
      INSERT OR IGNORE INTO agents (id, name, command, args, env, auth_preset, builtin, created_at, updated_at)
      VALUES (@id, @name, @command, @args, @env, @authPreset, 1, @now, @now)
    `)
    const now = Date.now()
    for (const agent of BUILTIN_AGENTS) {
      insert.run({
        id: agent.id,
        name: agent.name,
        command: agent.command,
        args: JSON.stringify(agent.args),
        env: JSON.stringify(agent.env),
        authPreset: agent.authPreset,
        now
      })
    }
  }

  /** List all agents in display order: Codex first, then alphabetical. */
  list(): AgentConfig[] {
    const rows = this.db.db
      .prepare(`SELECT * FROM agents`)
      .all() as Array<Record<string, unknown>>
    return rows
      .map(rowToConfig)
      .sort((a, b) => {
        if (a.id === 'codex') return -1
        if (b.id === 'codex') return 1
        return a.name.localeCompare(b.name)
      })
  }

  get(id: string): AgentConfig | null {
    const row = this.db.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? rowToConfig(row) : null
  }

  /** Insert or update a user-managed agent. Built-ins can be edited too. */
  upsert(config: AgentConfig): void {
    const now = Date.now()
    this.db.db
      .prepare(`
        INSERT INTO agents (id, name, command, args, env, auth_preset, builtin, created_at, updated_at)
        VALUES (@id, @name, @command, @args, @env, @authPreset, @builtin, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, command = @command, args = @args, env = @env,
          auth_preset = @authPreset, updated_at = @now
      `)
      .run({
        ...config,
        args: JSON.stringify(config.args),
        env: JSON.stringify(config.env),
        builtin: config.builtin ? 1 : 0,
        now
      })
  }

  /** Remove a user agent; built-ins cannot be deleted (only edited). */
  remove(id: string): boolean {
    const info = this.db.db
      .prepare(`DELETE FROM agents WHERE id = ? AND builtin = 0`)
      .run(id)
    return info.changes > 0
  }

  /**
   * Best-effort environment diagnostics: resolve the command on PATH
   * and ask for its version. Auth checks are preset-specific and may
   * be uncheckable (null) without spawning a full session.
   */
  async diagnose(agentId: string): Promise<AgentDiagnostics> {
    const agent = this.get(agentId)
    if (!agent) {
      return {
        agentId,
        commandFound: false,
        authOk: null,
        problems: [`agent '${agentId}' not found`]
      }
    }

    const problems: string[] = []
    const result = await runOnce(agent.command, agent.args[0] === 'acp' ? ['--version'] : ['--version'])

    if (!result.found) {
      problems.push(`command '${agent.command}' not found on PATH`)
    }

    // Auth presets we cannot verify without a real session report null.
    const authOk: boolean | null =
      agent.authPreset === 'custom' ? null : result.found ? null : false

    return {
      agentId,
      commandFound: result.found,
      commandPath: result.path,
      version: result.version,
      authOk,
      problems
    }
  }
}

interface RunResult {
  found: boolean
  path?: string
  version?: string
}

/** Run `command args` capturing output; resolves instead of throwing. */
function runOnce(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        // node err.code === 'ENOENT' means the binary itself is missing.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ found: false })
        } else {
          // Binary exists but failed (--version unsupported etc.).
          resolve({ found: true, version: (stderr || stdout || '').trim().slice(0, 200) })
        }
        return
      }
      resolve({ found: true, version: (stdout || stderr || '').trim().split('\n')[0]?.slice(0, 200) })
    })
  })
}
