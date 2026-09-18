/**
 * Landing pane when no session is selected: quick intro plus agent
 * readiness. Diagnostics run on demand so slow PATH probes never block
 * first paint.
 */
import { useEffect, useState } from 'react'
import type { AgentConfigDto, AgentDiagnosticsDto } from '../../shared/ipc'

interface Props {
  agents: AgentConfigDto[]
  onCreated: (id: string) => void
}

export function SessionHome({ agents }: Props): React.JSX.Element {
  const [diagnostics, setDiagnostics] = useState<Record<string, AgentDiagnosticsDto>>({})
  const [probing, setProbing] = useState(false)

  const probeAll = async (): Promise<void> => {
    setProbing(true)
    try {
      const results = await Promise.all(
        agents.map(async (a) => [a.id, await window.loomdesk.diagnoseAgent(a.id)] as const)
      )
      setDiagnostics(Object.fromEntries(results))
    } finally {
      setProbing(false)
    }
  }

  useEffect(() => {
    // Drop stale results when the agent list changes.
    setDiagnostics({})
  }, [agents])

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <h1 className="text-2xl font-semibold">LoomDesk</h1>
      <p className="mt-1 text-sm text-(--color-text-secondary)">
        Local-first desktop client for coding agents
      </p>

      <div className="mt-8 w-full max-w-md">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-(--color-text-secondary)">
            Agents
          </span>
          <button
            type="button"
            onClick={() => void probeAll()}
            disabled={probing || agents.length === 0}
            className="rounded border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-surface-hover) disabled:opacity-50"
          >
            {probing ? 'Checking…' : 'Check availability'}
          </button>
        </div>
        <ul className="divide-y divide-(--color-border) rounded-lg border border-(--color-border)">
          {agents.map((a) => {
            const diag = diagnostics[a.id]
            return (
              <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{a.name}</span>
                <span className="text-xs text-(--color-text-secondary)">
                  {diag
                    ? diag.commandFound
                      ? diag.version ?? 'installed'
                      : 'not found'
                    : '—'}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
