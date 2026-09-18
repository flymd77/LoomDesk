/**
 * Modal for creating a session: pick an agent, point it at an absolute
 * workspace directory, optionally title it. Creation only writes the
 * canonical record — the agent process starts on demand (open chat).
 */
import { useState } from 'react'
import type { AgentConfigDto, SessionRecordDto } from '../../shared/ipc'

interface Props {
  agents: AgentConfigDto[]
  onClose: () => void
  onCreated: (id: string) => void
}

export function NewSessionDialog({ agents, onClose, onCreated }: Props): React.JSX.Element {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [workspacePath, setWorkspacePath] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    if (!agentId) return setError('Pick an agent')
    if (!workspacePath.trim()) return setError('Workspace path is required')
    setBusy(true)
    try {
      const record: SessionRecordDto = await window.loomdesk.createSession({
        agentId,
        workspacePath: workspacePath.trim(),
        title: title.trim() || undefined
      })
      onCreated(record.id)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-5"
        role="dialog"
        aria-label="New session"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">New session</h2>

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="agent">
          Agent
        </label>
        <select
          id="agent"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="mb-3 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="workspace">
          Workspace path
        </label>
        <input
          id="workspace"
          value={workspacePath}
          onChange={(e) => setWorkspacePath(e.target.value)}
          placeholder="/absolute/path/to/project"
          className="mb-3 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
        />

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="title">
          Title (optional)
        </label>
        <input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
        />

        {error && <p className="mb-3 text-xs text-(--color-danger)">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-surface-hover)"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
