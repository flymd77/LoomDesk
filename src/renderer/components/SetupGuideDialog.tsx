/**
 * Guided setup modal for one agent. Steps are display-only: LoomDesk
 * never executes installs or logins itself — the user copies commands
 * into their own terminal so global installs and credentials stay
 * under their control. Commands copy with one click.
 */
import { useEffect, useState } from 'react'
import type { AgentSetupGuideDto } from '../../shared/ipc'

interface Props {
  agentId: string
  agentName: string
  onClose: () => void
}

export function SetupGuideDialog({ agentId, agentName, onClose }: Props): React.JSX.Element {
  const [guide, setGuide] = useState<AgentSetupGuideDto | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    void window.loomdesk.getSetupGuide(agentId).then((g) => {
      setGuide(g)
      setLoaded(true)
    })
  }, [agentId])

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard can be unavailable; the text is selectable anyway.
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[520px] overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-5"
        role="dialog"
        aria-label={`Setup ${agentName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold">Set up {agentName}</h2>
        <p className="mb-4 text-xs text-(--color-text-secondary)">
          Run these in your own terminal — LoomDesk never installs or logs in for you.
        </p>

        {loaded && !guide && (
          <p className="text-sm text-(--color-text-secondary)">
            No guided setup for this agent. Configure the command in the agent settings
            and authenticate with the CLI directly.
          </p>
        )}

        {guide && (
          <>
            <ol className="mb-4 space-y-3">
              {guide.steps.map((step, i) => (
                <li key={i} className="rounded border border-(--color-border) p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-(--color-accent)">
                      {i + 1}.
                    </span>
                    <span className="text-sm font-medium">{step.title}</span>
                  </div>
                  {step.detail && (
                    <p className="mb-2 mt-1 pl-5 text-xs text-(--color-text-secondary)">
                      {step.detail}
                    </p>
                  )}
                  {step.command && (
                    <div className="mt-2 flex items-center gap-2 pl-5">
                      <code className="flex-1 overflow-x-auto rounded bg-(--color-surface) px-2 py-1.5 text-xs whitespace-pre">
                        {step.command}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copy(step.command ?? '')}
                        className="shrink-0 rounded border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-surface-hover)"
                      >
                        {copied === step.command ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            {guide.notes.length > 0 && (
              <div className="mb-4 rounded border border-(--color-warning) p-3">
                <p className="mb-1 text-xs font-medium text-(--color-warning)">
                  Network notes
                </p>
                {guide.notes.map((n, i) => (
                  <p key={i} className="text-xs text-(--color-text-secondary)">
                    · {n}
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--color-accent-hover)"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
