/**
 * Scrollable message stream. Each role renders with its own treatment:
 * user right-aligned bubble, agent plain text, thought dimmed italic,
 * tool as a compact status card, system as centered hint text.
 */
import { useEffect, useRef } from 'react'
import type { MessageDto } from '../../shared/ipc'
import { ToolCallCard } from './ToolCallCard'

interface Props {
  messages: MessageDto[]
}

export function MessageList({ messages }: Props): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 && (
        <p className="mt-10 text-center text-sm text-(--color-text-secondary)">
          Send a message to start the conversation
        </p>
      )}
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  )
}

/** Extract display text from a message content payload. */
function textOf(content: unknown): string {
  const text = (content as { text?: string } | null)?.text
  return typeof text === 'string' ? text : String(content)
}

function MessageRow({ message }: { message: MessageDto }): React.JSX.Element {
  switch (message.role) {
    case 'user': {
      const text = textOf(message.content)
      return (
        <div className="mb-3 flex justify-end">
          <div className="max-w-[75%] rounded-lg bg-(--color-accent) px-3 py-2 text-sm whitespace-pre-wrap text-white">
            {text}
          </div>
        </div>
      )
    }
    case 'agent': {
      return (
        <div className="mb-3 max-w-[85%] text-sm whitespace-pre-wrap">
          {textOf(message.content)}
        </div>
      )
    }
    case 'thought':
      return (
        <div className="mb-3 max-w-[85%] text-sm text-(--color-text-secondary) italic whitespace-pre-wrap">
          {textOf(message.content)}
        </div>
      )
    case 'tool':
      return (
        <div className="mb-3">
          <ToolCallCard content={message.content} />
        </div>
      )
    case 'system':
      return (
        <div className="my-2 text-center text-xs text-(--color-text-secondary)">
          {String((message.content as { text?: string })?.text ?? '')}
        </div>
      )
  }
}
