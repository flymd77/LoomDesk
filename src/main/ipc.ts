import { ipcMain } from 'electron'
import { app } from 'electron'
import type { AppInfo } from '../shared/ipc'

/**
 * Central IPC registration for the main process.
 * All channels exposed to the renderer must be registered here so the
 * attack surface stays explicit and auditable.
 */
export function registerIpc(): void {
  ipcMain.handle('app:getInfo', (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    }
  })
}
