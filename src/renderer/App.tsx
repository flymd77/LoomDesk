import { useEffect, useState } from 'react'
import type { AppInfo } from '../shared/ipc'

// Type declaration for the API surface exposed by the preload script.
declare global {
  interface Window {
    loomdesk: {
      getAppInfo: () => Promise<AppInfo>
    }
  }
}

export function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.loomdesk
      .getAppInfo()
      .then(setAppInfo)
      .catch((err: unknown) => setError(String(err)))
  }, [])

  return (
    <main className="app">
      <h1>LoomDesk</h1>
      <p className="tagline">Local-first desktop client for coding agents</p>
      {error && <p className="error">Failed to load app info: {error}</p>}
      {appInfo && (
        <p className="app-info">
          {appInfo.name} v{appInfo.version} · Electron {appInfo.electronVersion} ·{' '}
          {appInfo.platform}
        </p>
      )}
    </main>
  )
}
