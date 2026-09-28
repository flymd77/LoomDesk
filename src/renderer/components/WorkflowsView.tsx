/**
 * Workflows surface: list of runs plus the detail pane showing the
 * Plan -> Execute -> Verify pipeline. SQLite remains canonical; this
 * view polls while a run is live so node states advance without a
 * push channel for workflows (yet).
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  AgentConfigDto,
  WorkflowAttemptDto,
  WorkflowNodeDto,
  WorkflowRunDto
} from '../../shared/ipc'
import { NewWorkflowDialog } from './NewWorkflowDialog'

const RUN_STATUS: Record<
  WorkflowRunDto['status'],
  { label: string; dot: string; text: string }
> = {
  planning: { label: 'Planning', dot: 'bg-(--color-warning)', text: '' },
  executing: { label: 'Executing', dot: 'bg-(--color-accent)', text: '' },
  verifying: { label: 'Verifying', dot: 'bg-(--color-accent)', text: '' },
  passed: { label: 'Passed', dot: 'bg-(--color-success)', text: '' },
  failed: { label: 'Failed', dot: 'bg-(--color-danger)', text: '' },
  cancelled: { label: 'Cancelled', dot: 'bg-(--color-border)', text: '' }
}

const NODE_STATUS_DOT: Record<WorkflowNodeDto['status'], string> = {
  pending: 'bg-(--color-border)',
  active: 'bg-(--color-accent)',
  passed: 'bg-(--color-success)',
  failed: 'bg-(--color-danger)',
  skipped: 'bg-(--color-border)'
}

const LIVE_STATUSES: WorkflowRunDto['status'][] = [
  'planning',
  'executing',
  'verifying'
]

function isLive(run: WorkflowRunDto): boolean {
  return LIVE_STATUSES.includes(run.status)
}

interface Props {
  agents: AgentConfigDto[]
}

export function WorkflowsView({ agents }: Props): React.JSX.Element {
  const [runs, setRuns] = useState<WorkflowRunDto[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setRuns(await window.loomdesk.listWorkflows())
  }, [])

  useEffect(() => {
    void refresh()
    // Poll while anything is live; cheap local DB reads.
    const t = setInterval(() => void refresh(), 2000)
    return () => clearInterval(t)
  }, [refresh])

  const selected = runs.find((r) => r.id === selectedId) ?? null
  const agentName = (id: string): string => agents.find((a) => a.id === id)?.name ?? id

  return (
    <div className="flex h-full">
      {/* Run list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-raised)">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold tracking-wide">Workflows</span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded bg-(--color-accent) px-2 py-1 text-xs font-medium text-white hover:bg-(--color-accent-hover)"
          >
            New workflow
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {runs.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-(--color-text-secondary)">
              No workflows yet
            </p>
          )}
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => setSelectedId(run.id)}
              className={`mb-1 w-full rounded px-2 py-2 text-left text-sm hover:bg-(--color-surface-hover) ${
                selectedId === run.id ? 'bg-(--color-surface-hover)' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${RUN_STATUS[run.status].dot}`}
                  aria-hidden
                />
                <span className="truncate">{run.title || 'Untitled workflow'}</span>
              </span>
              <span className="mt-0.5 block pl-4 text-xs text-(--color-text-secondary)">
                {agentName(run.agentId)} · {RUN_STATUS[run.status].label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <WorkflowDetail
            key={selected.id}
            run={selected}
            agentName={agentName(selected.agentId)}
            onChanged={refresh}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-(--color-text-secondary)">
            Select a workflow to see its Plan → Execute → Verify pipeline
          </div>
        )}
      </div>

      {creating && (
        <NewWorkflowDialog
          agents={agents}
          onClose={() => setCreating(false)}
          onCreated={(run) => {
            setCreating(false)
            void refresh().then(() => setSelectedId(run.id))
          }}
        />
      )}
    </div>
  )
}

interface DetailProps {
  run: WorkflowRunDto
  agentName: string
  onChanged: () => void
}

function WorkflowDetail({ run, agentName, onChanged }: DetailProps): React.JSX.Element {
  const [nodes, setNodes] = useState<WorkflowNodeDto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track node state; re-fetch whenever the run row changes (the parent
  // refreshes runs on a 2s cadence, which re-renders this component).
  useEffect(() => {
    void window.loomdesk.workflowNodes(run.id).then(setNodes)
  }, [run.id, run.updatedAt])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const live = isLive(run)
  const status = RUN_STATUS[run.status]
  // A planning run is startable only when nothing has begun: the plan
  // node still pending means the pipeline was never launched.
  const startable = run.status === 'planning' && nodes.every((n) => n.status === 'pending')

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${status.dot}`} aria-hidden />
        <h1 className="text-lg font-semibold">{run.title || 'Untitled workflow'}</h1>
      </div>
      <p className="mb-1 text-xs text-(--color-text-secondary)">
        {agentName} · {run.workspacePath} · {status.label}
      </p>
      <p className="mb-4 text-sm whitespace-pre-wrap">{run.goal}</p>

      <div className="mb-4 flex items-center gap-2">
        {startable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => window.loomdesk.startWorkflow(run.id))}
            className="rounded bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}
        {live && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => window.loomdesk.cancelWorkflow(run.id))}
            className="rounded border border-(--color-danger) px-3 py-1.5 text-sm text-(--color-danger) hover:bg-(--color-danger)/10 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        {!live && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => window.loomdesk.removeWorkflow(run.id))}
            className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-surface-hover) disabled:opacity-50"
          >
            Delete
          </button>
        )}
        <span className="ml-auto rounded border border-(--color-border) px-2 py-1 font-mono text-xs text-(--color-text-secondary)">
          {run.verifyCommand}
        </span>
      </div>

      {error && <p className="mb-4 text-xs text-(--color-danger)">{error}</p>}

      {/* Pipeline */}
      <div className="mb-2 flex items-center gap-1 text-xs text-(--color-text-secondary)">
        {(['plan', 'execute', 'verify'] as const).map((kind, i) => {
          const node = nodes.find((n) => n.kind === kind)
          const dot = node ? NODE_STATUS_DOT[node.status] : 'bg-(--color-border)'
          return (
            <span key={kind} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>→</span>}
              <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
              <span className="capitalize">{kind}</span>
            </span>
          )
        })}
      </div>

      {nodes.map((node) => (
        <NodeCard key={node.id} node={node} refreshKey={run.updatedAt} />
      ))}
    </div>
  )
}

function NodeCard({
  node,
  refreshKey
}: {
  node: WorkflowNodeDto
  refreshKey: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [attempts, setAttempts] = useState<WorkflowAttemptDto[] | null>(null)

  // While expanded, keep attempts in sync with the run (the parent
  // re-renders on its 2s refresh cadence, changing refreshKey).
  useEffect(() => {
    if (!open) return
    void window.loomdesk.workflowAttempts(node.id).then(setAttempts)
  }, [open, node.id, refreshKey])

  const toggle = (): void => {
    if (!open && attempts === null) {
      void window.loomdesk.workflowAttempts(node.id).then(setAttempts)
    }
    setOpen(!open)
  }

  return (
    <div className="mb-3 rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${NODE_STATUS_DOT[node.status]}`}
          aria-hidden
        />
        <span className="text-sm font-medium capitalize">{node.kind}</span>
        <span className="ml-auto text-xs text-(--color-text-secondary)">
          {node.status}
        </span>
        <span className="text-xs text-(--color-text-secondary)" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {node.summary && (
        <p className="px-3 pb-2 text-xs whitespace-pre-wrap text-(--color-text-secondary)">
          {node.summary.slice(0, 300)}
          {node.summary.length > 300 ? '…' : ''}
        </p>
      )}
      {open && attempts !== null && (
        <div className="border-t border-(--color-border) px-3 py-2">
          {attempts.length === 0 && (
            <p className="text-xs text-(--color-text-secondary)">Not started yet</p>
          )}
          {attempts.map((a) => (
            <div key={a.id} className="mb-2 last:mb-0">
              <p className="text-xs text-(--color-text-secondary)">
                prompt:{' '}
                <span className="font-mono">{a.prompt.slice(0, 120)}{a.prompt.length > 120 ? '…' : ''}</span>
              </p>
              {a.result && (
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-(--color-surface) p-2 text-xs whitespace-pre-wrap">
                  {a.result}
                </pre>
              )}
              {a.exitCode !== null && (
                <p className={`mt-1 text-xs ${a.exitCode === 0 ? 'text-(--color-success)' : 'text-(--color-danger)'}`}>
                  exit code: {a.exitCode}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
