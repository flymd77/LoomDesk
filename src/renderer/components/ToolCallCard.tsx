/**
 * Compact card for one tool call update. Status maps to a colored dot;
 * the raw payload stays available via the title attribute for now —
 * args/results rendering expands in a later PR.
 */
import type { ToolCallUpdate } from '../../shared/ipc'

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-(--color-text-secondary)',
  in_progress: 'bg-(--color-accent)',
  completed: 'bg-(--color-success)',
  failed: 'bg-(--color-danger)'
}

export function ToolCallCard({ content }: { content: unknown }): React.JSX.Element {
  const tool = content as ToolCallUpdate
  if (!tool || typeof tool !== 'object' || !tool.toolCallId) {
    return <div className="text-xs text-(--color-text-secondary)">{String(content)}</div>
  }
  const status = tool.status ?? 'in_progress'
  return (
    <div
      className="inline-flex max-w-[85%] items-center gap-2 rounded border border-(--color-border) bg-(--color-surface-raised) px-3 py-1.5 text-xs"
      title={JSON.stringify(tool)}
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.pending}`}
        aria-hidden
      />
      <span className="font-medium">{tool.title ?? 'Tool call'}</span>
      <span className="text-(--color-text-secondary)">{status}</span>
    </div>
  )
}
