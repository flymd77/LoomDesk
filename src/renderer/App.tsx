/**
 * App shell: owns global state (agents, sessions, selection) and the
 * two-pane layout. Data flows one way — main process is canonical,
 * this tree is a projection refreshed via IPC calls and push events.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  AgentConfigDto,
  SessionEventDto,
  SessionRecordDto,
  SessionSummaryDto
} from '../shared/ipc'
import { Sidebar } from './components/Sidebar'
import { SessionHome } from './components/SessionHome'
import { ConversationView } from './components/ConversationView'

export function App(): React.JSX.Element {
  const [agents, setAgents] = useState<AgentConfigDto[]>([])
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeRecord, setActiveRecord] = useState<SessionRecordDto | null>(null)

  const refreshSessions = useCallback(async (): Promise<void> => {
    setSessions(await window.loomdesk.listSessions())
  }, [])

  // Selection changes load the full record; refreshes keep it current.
  useEffect(() => {
    if (!activeId) {
      setActiveRecord(null)
      return
    }
    void window.loomdesk.getSession(activeId).then(setActiveRecord)
  }, [activeId])

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
        {activeId && activeRecord ? (
          <ConversationView
            key={activeRecord.id}
            session={activeRecord}
            onStatusChange={refreshSessions}
          />
        ) : activeId ? (
          <div className="p-6 text-sm text-(--color-text-secondary)">Loading…</div>
        ) : (
          <SessionHome
            agents={agents}
            onCreated={(id) => {
              setActiveId(id)
              void refreshSessions()
            }}
          />
        )}
      </main>
    </div>
  )
}
