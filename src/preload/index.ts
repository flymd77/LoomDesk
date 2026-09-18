import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo } from '../shared/ipc'

/**
 * Hardened bridge between the renderer and main process.
 * Only whitelisted channels are exposed; the renderer never gets
 * direct access to Node or Electron internals.
 */
const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:getInfo')
}

export type LoomDeskApi = typeof api

contextBridge.exposeInMainWorld('loomdesk', api)
