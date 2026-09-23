import type { DbHandle } from './db'

/**
 * Key-value settings store backed by the canonical database. Values are
 * JSON-encoded; keys are dot-namespaced (e.g. 'feishu.appId'). Secrets
 * live here too — the file is local-only under the user data dir.
 */
export class SettingsStore {
  constructor(private readonly db: DbHandle) {}

  /** Read one setting; null when unset. */
  get<T>(key: string): T | null {
    const row = this.db.db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined
    if (!row) return null
    return JSON.parse(row.value) as T
  }

  /** Write one setting (insert or update). */
  set<T>(key: string, value: T): void {
    this.db.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), Date.now())
  }

  /** Remove one setting. Idempotent. */
  delete(key: string): void {
    this.db.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
  }

  /** All keys under a namespace, e.g. namespace 'feishu' -> 'feishu.appId'. */
  list(namespace: string): Record<string, unknown> {
    const rows = this.db.db
      .prepare(`SELECT key, value FROM settings WHERE key LIKE ?`)
      .all(`${namespace}.%`) as Array<{ key: string; value: string }>
    const out: Record<string, unknown> = {}
    for (const row of rows) {
      out[row.key.slice(namespace.length + 1)] = JSON.parse(row.value)
    }
    return out
  }
}
