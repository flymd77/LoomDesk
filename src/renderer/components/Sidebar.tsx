/**
 * Left rail: session list ordered by activity plus the new-session
 * action. Sessions are read-only here; destructive actions live in the
 * conversation view once it exists.
 */
import { useState } from 'react'
import type { AgentConfigDto, SessionSummaryDto } from '../../shared/ipc'
import { NewSessionDialog } from './NewSessionDialog'
import { SettingsDialog } from './SettingsDialog'

const STATUS_DOT: Record<SessionSummaryDto['status'], string> = {
  idle: 'bg-(--color-success)',
  running: 'bg-(--color-accent)',
  waiting_permission: 'bg-(--color-warning)',
  closed: 'bg-(--color-border)'
}

/** Compact token count: 1234 -> 1.2k, 5678000 -> 5.7M. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface Props {
  sessions: SessionSummaryDto[]
  agents: AgentConfigDto[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreated: () => void
  view: 'sessions' | 'workflows'
  onViewChange: (view: 'sessions' | 'workflows') => void
}

export function Sidebar({
  sessions,
  agents,
  activeId,
  onSelect,
  onCreated,
  view,
  onViewChange
}: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-raised)">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-wide">LoomDesk</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            className="rounded border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-surface-hover)"
          >
            ⚙
          </button>
          {view === 'sessions' && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded bg-(--color-accent) px-2 py-1 text-xs font-medium text-white hover:bg-(--color-accent-hover)"
            >
              New session
            </button>
          )}
        </div>
      </div>

      {/* Surface switch: chat sessions or controlled workflows. */}
      <div className="mx-2 mb-1 grid grid-cols-2 gap-1 rounded border border-(--color-border) p-1">
        {(['sessions', 'workflows'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={`rounded px-2 py-1 text-xs capitalize ${
              view === v
                ? 'bg-(--color-surface-hover) font-medium'
                : 'text-(--color-text-secondary) hover:bg-(--color-surface-hover)'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <nav
        className={`flex-1 overflow-y-auto px-2 pb-2 ${view === 'workflows' ? 'hidden' : ''}`}
      >
        {sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-(--color-text-secondary)">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => {
          const agent = agents.find((a) => a.id === s.agentId)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`mb-1 w-full rounded px-2 py-2 text-left text-sm hover:bg-(--color-surface-hover) ${
                activeId === s.id ? 'bg-(--color-surface-hover)' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s.status]}`}
                  aria-hidden
                />
                <span className="truncate">{s.title || 'Untitled'}</span>
              </span>
              <span className="mt-0.5 block pl-4 text-xs text-(--color-text-secondary)">
                {agent?.name ?? s.agentId} · {s.messageCount} messages
                {s.inputTokens + s.outputTokens > 0 &&
                  ` · ${formatTokens(s.inputTokens + s.outputTokens)} tok`}
              </span>
            </button>
          )
        })}
      </nav>

      {creating && (
        <NewSessionDialog
          agents={agents}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onCreated()
            onSelect(id)
          }}
        />
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </aside>
  )
}
