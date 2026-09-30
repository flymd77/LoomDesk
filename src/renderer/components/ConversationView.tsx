/**
 * Conversation pane for one session. Owns the agent process lifecycle:
 * mounting starts the session, unmounting disposes it. Message state
 * is seeded from the persisted history and extended live by push
 * events; the store in main stays canonical.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MessageDto,
  MessageEventPayload,
  QueuedEventPayload,
  SessionRecordDto,
  SessionSummaryDto,
  UsageEventPayload
} from '../../shared/ipc'
import { MessageList } from './MessageList'
import { PromptInput } from './PromptInput'

interface Props {
  session: SessionRecordDto
  onStatusChange: () => void
}

/** Compact token count: 1234 -> 1.2k, 5678000 -> 5.7M. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function ConversationView({ session, onStatusChange }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<MessageDto[]>([])
  const [status, setStatus] = useState<SessionSummaryDto['status'] | null>(null)
  const [usage, setUsage] = useState({ input: session.inputTokens, output: session.outputTokens })
  const [queued, setQueued] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)

  // Track the active session id so late push events from a previous
  // session are dropped after switching.
  const sessionIdRef = useRef(session.id)

  useEffect(() => {
    sessionIdRef.current = session.id
    setMessages([])
    setError(null)
    setStarting(true)
    setUsage({ input: session.inputTokens, output: session.outputTokens })
    setQueued(0)

    let disposed = false

    const run = async (): Promise<void> => {
      try {
        const history = await window.loomdesk.history(session.id)
        if (!disposed) setMessages(history)

        const record = await window.loomdesk.getSession(session.id)
        // Start the agent unless it is already online; closed sessions
        // restart fine because start() re-creates the process.
        if (record && record.status !== 'running' && record.status !== 'idle') {
          await window.loomdesk.startSession(session.id)
        }
        if (!disposed) setStarting(false)
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err))
          setStarting(false)
        }
      }
    }
    void run()

    const offEvent = window.loomdesk.onSessionEvent((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      if (event.type === 'message') {
        const payload = event.payload as MessageEventPayload
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(), // ephemeral render id
            sessionId: event.sessionId,
            role: payload.role,
            content: payload.content,
            createdAt: Date.now()
          }
        ])
      } else if (event.type === 'status') {
        const payload = event.payload as { status: SessionSummaryDto['status'] }
        setStatus(payload.status)
        onStatusChange()
      } else if (event.type === 'usage') {
        const payload = event.payload as UsageEventPayload
        setUsage({ input: payload.inputTokens, output: payload.outputTokens })
      } else if (event.type === 'queued') {
        const payload = event.payload as QueuedEventPayload
        setQueued(payload.queued)
      }
    })

    return () => {
      disposed = true
      offEvent?.()
      // Fire-and-forget teardown; the canonical record survives.
      void window.loomdesk.disposeSession(session.id).catch(() => undefined)
    }
  }, [session.id, onStatusChange])

  const send = useCallback(
    async (text: string): Promise<void> => {
      setError(null)
      try {
        await window.loomdesk.promptSession(session.id, text)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [session.id]
  )

  const stop = useCallback((): void => {
    void window.loomdesk.stopSession(session.id)
  }, [session.id])

  const running = status === 'running' || starting
  const usageLabel =
    usage.input + usage.output > 0
      ? `${formatTokens(usage.input)} in / ${formatTokens(usage.output)} out`
      : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-(--color-border) px-4 py-2">
        <span className="truncate text-sm font-medium">{session.title || 'Untitled'}</span>
        <div className="flex items-center gap-2">
          {usageLabel && (
            <span
              className="text-xs text-(--color-text-secondary)"
              title={`${usage.input} input / ${usage.output} output tokens`}
            >
              {usageLabel}
            </span>
          )}
          {queued > 0 && (
            <span className="text-xs text-(--color-warning)" title="Prompts waiting to run">
              {queued} queued
            </span>
          )}
          {status && (
            <span className="text-xs text-(--color-text-secondary)">{status}</span>
          )}
          <button
            type="button"
            onClick={stop}
            disabled={!running}
            className="rounded border border-(--color-border) px-2 py-1 text-xs hover:bg-(--color-surface-hover) disabled:opacity-40"
          >
            Stop
          </button>
        </div>
      </header>

      {error && (
        <p className="border-b border-(--color-border) bg-(--color-surface-raised) px-4 py-2 text-xs text-(--color-danger)">
          {error}
        </p>
      )}

      <MessageList messages={messages} />
      <PromptInput disabled={starting} onSend={(t) => void send(t)} />
    </div>
  )
}
