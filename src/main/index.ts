import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { openDatabase } from './store/db'
import { AgentRegistry } from './agents/registry'
import { SessionStore } from './store/sessions'
import { SettingsStore } from './store/settings'
import { SessionService } from './sessions/service'
import { NotifyService } from './notify/service'

// Keep a global reference to the window object to avoid garbage collection closing the window.
let mainWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in the system browser instead of a new window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In dev, electron-vite serves the renderer; in prod, load the built file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Canonical state lives in the user data directory.
  const db = openDatabase(app.getPath('userData'))
  const agents = new AgentRegistry(db)
  const sessions = new SessionStore(db)
  const settings = new SettingsStore(db)
  const service = new SessionService(sessions, agents)
  const notify = new NotifyService(sessions, settings)

  // Session status transitions drive IM notifications (fire-and-forget).
  service.onStatus((sessionId, status) => {
    void notify.onStatusChange(sessionId, status)
  })

  registerIpc({ agents, sessions, service, notify })
  createMainWindow()

  app.on('activate', () => {
    // Re-create the window on macOS when the dock icon is clicked and no windows are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Standard behavior: quit on all platforms except macOS.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
