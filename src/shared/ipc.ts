/**
 * IPC contract shared between main, preload and renderer.
 * Keep this file as the single source of truth for channel names and payload types.
 */

export interface AppInfo {
  name: string
  version: string
  platform: string
  electronVersion: string
  nodeVersion: string
}
