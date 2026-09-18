import { app, ipcMain } from 'electron'
import type { AppInfo } from '../shared/ipc'
import type { AgentRegistry } from './agents/registry'
import type { SessionStore, SessionSummary, SessionRecord } from './store/sessions'
import type { SessionService } from './sessions/service'
import type { AgentConfig, AgentDiagnostics } from './agents/types'

/**
 * Central IPC registration. All channels exposed to the renderer are
 * registered here so the attack surface stays explicit and auditable.
 * Channel names are grouped by domain: app / agents / sessions.
 */
export interface IpcDeps {
  agents: AgentRegistry
  sessions: SessionStore
  service: SessionService
}

export function registerIpc(deps: IpcDeps): void {
  // ---------- app ----------
  ipcMain.handle('app:getInfo', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    }
  })

  // ---------- agents ----------
  ipcMain.handle('agents:list', (): AgentConfig[] => deps.agents.list())

  ipcMain.handle('agents:diagnose', (_e, agentId: string): Promise<AgentDiagnostics> =>
    deps.agents.diagnose(agentId)
  )

  // ---------- sessions ----------
  ipcMain.handle(
    'sessions:create',
    (_e, params: { agentId: string; workspacePath: string; title?: string }): SessionRecord =>
      deps.sessions.create(params.agentId, params.workspacePath, params.title ?? '')
  )

  ipcMain.handle('sessions:list', (_e, limit?: number): SessionSummary[] =>
    deps.sessions.list(limit)
  )

  ipcMain.handle('sessions:get', (_e, id: string): SessionRecord | null => deps.sessions.get(id))

  ipcMain.handle('sessions:remove', (_e, id: string): boolean => {
    void deps.service.dispose(id).catch(() => undefined)
    return deps.sessions.remove(id)
  })

  ipcMain.handle(
    'sessions:history',
    (_e, id: string, beforeId?: number, limit?: number) => deps.service.history(id, beforeId, limit)
  )

  ipcMain.handle('sessions:start', async (_e, id: string): Promise<boolean> => {
    await deps.service.start(id)
    return true
  })

  ipcMain.handle('sessions:prompt', (_e, id: string, text: string) =>
    deps.service.prompt(id, text)
  )

  ipcMain.handle('sessions:stop', (_e, id: string): boolean => {
    deps.service.stop(id)
    return true
  })

  ipcMain.handle('sessions:dispose', async (_e, id: string): Promise<boolean> => {
    await deps.service.dispose(id)
    return true
  })
}
