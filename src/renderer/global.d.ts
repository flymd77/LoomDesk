// Global type for the hardened bridge exposed by the preload script.
// The implementation in src/preload/index.ts conforms to LoomDeskApi;
// this declaration makes `window.loomdesk` visible to the renderer.
import type { LoomDeskApi } from '../shared/ipc'

declare global {
  interface Window {
    loomdesk: LoomDeskApi
  }
}

export {}
