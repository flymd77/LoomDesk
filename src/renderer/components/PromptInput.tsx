/**
 * Prompt composer: Enter sends, Shift+Enter inserts a newline.
 * Disabled while the session is starting or a turn is in flight.
 */
import { useState } from 'react'

interface Props {
  disabled: boolean
  onSend: (text: string) => void
}

export function PromptInput({ disabled, onSend }: Props): React.JSX.Element {
  const [text, setText] = useState('')

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="border-t border-(--color-border) p-3">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={disabled ? 'Waiting for agent…' : 'Send a prompt (Enter to send)'}
          disabled={disabled}
          className="flex-1 resize-none rounded border border-(--color-border) bg-(--color-surface-raised) px-3 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  )
}
