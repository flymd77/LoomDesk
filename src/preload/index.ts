import { contextBridge, ipcRenderer } from 'electron'
import type { LoomDeskApi, SessionEventDto } from '../shared/ipc'

/**
 * Hardened bridge between the renderer and main process.
 * Only whitelisted channels are exposed; the renderer never gets
 * direct access to Node or Electron internals.
 */
const api: LoomDeskApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),

  listAgents: () => ipcRenderer.invoke('agents:list'),
  diagnoseAgent: (agentId) => ipcRenderer.invoke('agents:diagnose', agentId),

  createSession: (params) => ipcRenderer.invoke('sessions:create', params),
  listSessions: (limit) => ipcRenderer.invoke('sessions:list', limit),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  removeSession: (id) => ipcRenderer.invoke('sessions:remove', id),
  history: (id, beforeId, limit) => ipcRenderer.invoke('sessions:history', id, beforeId, limit),
  startSession: (id) => ipcRenderer.invoke('sessions:start', id),
  promptSession: (id, text) => ipcRenderer.invoke('sessions:prompt', id, text),
  stopSession: (id) => ipcRenderer.invoke('sessions:stop', id),
  disposeSession: (id) => ipcRenderer.invoke('sessions:dispose', id),

  onSessionEvent: (handler) => {
    const listener = (_e: unknown, event: SessionEventDto): void => handler(event)
    ipcRenderer.on('loomdesk:session-event', listener)
    return () => ipcRenderer.removeListener('loomdesk:session-event', listener)
  },

  getFeishuSettings: () => ipcRenderer.invoke('notify:feishu:get'),
  setFeishuSettings: (values) => ipcRenderer.invoke('notify:feishu:set', values),
  testFeishu: () => ipcRenderer.invoke('notify:feishu:test'),

  getSetupGuide: (agentId) => ipcRenderer.invoke('agents:setupGuide', agentId)
}

contextBridge.exposeInMainWorld('loomdesk', api)
