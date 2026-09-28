/**
 * Create-workflow modal: goal, verify command, agent and workspace.
 * The verify command is the contract — its exit code alone decides
 * pass/fail, so the form repeats that emphasis.
 */
import { useState } from 'react'
import type { AgentConfigDto, WorkflowRunDto } from '../../shared/ipc'

interface Props {
  agents: AgentConfigDto[]
  onClose: () => void
  onCreated: (run: WorkflowRunDto) => void
}

export function NewWorkflowDialog({ agents, onClose, onCreated }: Props): React.JSX.Element {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [workspacePath, setWorkspacePath] = useState('')
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [verifyCommand, setVerifyCommand] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    if (!agentId) return setError('Pick an agent')
    if (!workspacePath.trim()) return setError('Workspace path is required')
    if (!goal.trim()) return setError('Describe the goal')
    if (!verifyCommand.trim()) return setError('A verify command is required')
    setBusy(true)
    try {
      const run = await window.loomdesk.createWorkflow({
        agentId,
        workspacePath: workspacePath.trim(),
        title: title.trim() || goal.trim().slice(0, 60),
        goal: goal.trim(),
        verifyCommand: verifyCommand.trim()
      })
      onCreated(run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm'

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[520px] overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-5"
        role="dialog"
        aria-label="New workflow"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">New workflow</h2>

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="wf-agent">
          Agent
        </label>
        <select
          id="wf-agent"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className={`${input} mb-3`}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="wf-ws">
          Workspace path
        </label>
        <input
          id="wf-ws"
          value={workspacePath}
          onChange={(e) => setWorkspacePath(e.target.value)}
          placeholder="/absolute/path/to/project"
          className={`${input} mb-3`}
        />

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="wf-title">
          Title (optional)
        </label>
        <input
          id="wf-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`${input} mb-3`}
        />

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="wf-goal">
          Goal
        </label>
        <textarea
          id="wf-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="What should the agent accomplish?"
          className={`${input} mb-3`}
        />

        <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="wf-verify">
          Verify command (exit code decides pass/fail)
        </label>
        <input
          id="wf-verify"
          value={verifyCommand}
          onChange={(e) => setVerifyCommand(e.target.value)}
          placeholder="npm test"
          className={`${input} mb-1`}
        />
        <p className="mb-4 text-xs text-(--color-text-secondary)">
          Run in the workspace through the shell. The agent's own claims never count.
        </p>

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
