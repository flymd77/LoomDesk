/**
 * App shell: owns global state (agents, sessions, selection) and the
 * two-pane layout. Data flows one way — main process is canonical,
 * this tree is a projection refreshed via IPC calls and push events.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  AgentConfigDto,
  SessionEventDto,
  SessionSummaryDto
} from '../shared/ipc'
import { Sidebar } from './components/Sidebar'
import { SessionHome } from './components/SessionHome'

export function App(): React.JSX.Element {
  const [agents, setAgents] = useState<AgentConfigDto[]>([])
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const refreshSessions = useCallback(async (): Promise<void> => {
    setSessions(await window.loomdesk.listSessions())
  }, [])

  useEffect(() => {
    void window.loomdesk.listAgents().then(setAgents)
    void refreshSessions()
    // Push events refresh the list; status changes re-order by activity.
    const off = window.loomdesk.onSessionEvent((event: SessionEventDto) => {
      if (event.type === 'status' || event.type === 'message') void refreshSessions()
    })
    return off
  }, [refreshSessions])

  return (
    <div className="flex h-screen">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onCreated={refreshSessions}
        agents={agents}
      />
      <main className="flex-1 overflow-hidden">
        {activeId ? (
          <div className="p-6 text-sm text-(--color-text-secondary)">
            Conversation view lands in the next PR (session {activeId}).
          </div>
        ) : (
          <SessionHome agents={agents} onCreated={(id) => {
            setActiveId(id)
            void refreshSessions()
          }} />
        )}
      </main>
    </div>
  )
}
