import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SQLite storage for canonical state (agents + sessions + messages).
 *
 * The database file lives under the user data dir in production and
 * under a temp dir in tests. All schema changes happen here via
 * sequential migrations; no other module issues DDL.
 */

export interface DbHandle {
  db: Database.Database
  /** Absolute path of the database file (useful for diagnostics). */
  path: string
  /** Close the handle. Idempotent. */
  close(): void
}

let cached: DbHandle | null = null

/** Open (or reuse) the canonical database under the given directory. */
export function openDatabase(dir: string): DbHandle {
  if (cached && cached.path.startsWith(dir)) {
    return cached
  }
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'loomdesk.db')
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db)

  cached = {
    db,
    path,
    close: () => {
      db.close()
      if (cached?.db === db) cached = null
    }
  }
  return cached
}

/** Close any cached handle (used by tests between temp dirs). */
export function closeCachedDatabase(): void {
  cached?.close()
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT NOT NULL,        -- JSON array
      env TEXT NOT NULL,         -- JSON object
      auth_preset TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      title TEXT NOT NULL DEFAULT '',
      workspace_path TEXT NOT NULL,
      acp_session_id TEXT,       -- agent-side session id once created
      status TEXT NOT NULL,      -- 'idle' | 'running' | 'waiting_permission' | 'closed'
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,        -- 'user' | 'agent' | 'thought' | 'tool' | 'system'
      content TEXT NOT NULL,     -- JSON payload (text or structured update)
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,      -- dot-separated namespace, e.g. 'feishu.appId'
      value TEXT NOT NULL,       -- JSON-encoded value
      updated_at INTEGER NOT NULL
    );
  `)
}
