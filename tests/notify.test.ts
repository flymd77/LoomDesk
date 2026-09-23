import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeCachedDatabase, openDatabase, type DbHandle } from '../src/main/store/db'
import { SettingsStore } from '../src/main/store/settings'
import { SessionStore } from '../src/main/store/sessions'
import { AgentRegistry } from '../src/main/agents/registry'
import { SessionService } from '../src/main/sessions/service'
import { NotifyService } from '../src/main/notify/service'
import { FeishuClient, type FeishuConfig } from '../src/main/notify/feishu'

/**
 * Notification layer tests: settings persistence, status-transition
 * filtering, and Feishu client behavior against a local HTTP server
 * standing in for the open platform.
 */

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

let dir: string
let db: DbHandle
let settings: SettingsStore
let sessions: SessionStore
let service: SessionService
let notify: NotifyService

beforeEach(() => {
  closeCachedDatabase()
  dir = mkdtempSync(join(tmpdir(), 'loomdesk-notify-'))
  db = openDatabase(dir)
  new AgentRegistry(db) // seed builtins (FK target)
  sessions = new SessionStore(db)
  settings = new SettingsStore(db)
  service = new SessionService(sessions, new AgentRegistry(db))
  notify = new NotifyService(sessions, settings)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('round-trips values and lists by namespace', () => {
    settings.set('feishu.appId', 'cli_x')
    settings.set('feishu.appSecret', 's3cret')
    settings.set('other.key', 42)

    expect(settings.get<string>('feishu.appId')).toBe('cli_x')
    expect(settings.list('feishu')).toEqual({ appId: 'cli_x', appSecret: 's3cret' })
    expect(settings.list('other')).toEqual({ key: 42 })

    settings.set('feishu.appId', 'cli_y')
    expect(settings.get('feishu.appId')).toBe('cli_y')

    settings.delete('feishu.appId')
    expect(settings.get('feishu.appId')).toBeNull()
  })

  it('persists across reopen', () => {
    settings.set('feishu.chatId', 'oc_1')
    db.close()
    db = openDatabase(dir)
    settings = new SettingsStore(db)
    expect(settings.get('feishu.chatId')).toBe('oc_1')
  })
})

describe('NotifyService status filtering', () => {
  it('notifies on idle transition only once per state', async () => {
    const record = sessions.create('codex', tmpdir(), 't')
    const sent: string[] = []
    vi.spyOn(notify['feishu'], 'sendCard').mockImplementation(async (card) => {
      sent.push(card.title)
      return 'm1'
    })

    notify.setFeishuSettings({ enabled: true, appId: 'a', appSecret: 's', chatId: 'c' })

    // running -> not phone-worthy; idle -> notify; idle again -> dedup
    await notify.onStatusChange(record.id, 'running')
    await notify.onStatusChange(record.id, 'idle')
    await notify.onStatusChange(record.id, 'idle')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Task finished')
  })

  it('does nothing when feishu is disabled', async () => {
    const record = sessions.create('codex', tmpdir(), 't')
    const send = vi.spyOn(notify['feishu'], 'sendCard')
    await notify.onStatusChange(record.id, 'idle')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('FeishuClient', () => {
  let serverUrl: string
  let server: import('node:http').Server
  let requests: Array<{ path: string; body: Record<string, unknown> }>

  beforeEach(async () => {
    const http = await import('node:http')
    requests = []
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        requests.push({ path: req.url ?? '', body: body ? JSON.parse(body) : {} })
        if (req.url?.includes('/tenant_access_token')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ code: 0, tenant_access_token: 'tok', expire: 3600 }))
        } else if (req.url?.includes('/im/v1/messages')) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ code: 0, data: { message_id: 'om_x' } }))
        } else {
          res.statusCode = 404
          res.end('{}')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    serverUrl = `http://127.0.0.1:${addr.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function makeClient(cfg: FeishuConfig | null): FeishuClient {
    return new FeishuClient(() => cfg)
  }

  it('throws a clear error when unconfigured', async () => {
    const client = makeClient(null)
    await expect(client.sendCard({ title: 'x', elements: [] })).rejects.toThrow(
      /not configured/
    )
  })

  it('acquires a token and posts the card with auth header', async () => {
    const client = makeClient({ appId: 'a', appSecret: 's', chatId: 'chat1' })
    // Point the client at the local server.
    ;(client as unknown as { base: () => string }).base = () => serverUrl

    const id = await client.sendCard({ title: 'Hello', elements: ['line 1'], headerColor: 'green' })
    expect(id).toBe('om_x')

    expect(requests).toHaveLength(2)
    expect(requests[0].body).toMatchObject({ app_id: 'a', app_secret: 's' })
    expect(requests[1].body).toMatchObject({ receive_id: 'chat1', msg_type: 'interactive' })
  })

  it('caches the token across sends', async () => {
    const client = makeClient({ appId: 'a', appSecret: 's', chatId: 'chat1' })
    ;(client as unknown as { base: () => string }).base = () => serverUrl

    await client.sendCard({ title: 'one', elements: [] })
    await client.sendCard({ title: 'two', elements: [] })
    const tokenRequests = requests.filter((r) => r.path.includes('tenant_access_token'))
    expect(tokenRequests).toHaveLength(1)
  })

  it('reports test() failure for bad credentials', async () => {
    const client = makeClient({ appId: '', appSecret: '', chatId: '' })
    const result = await client.test()
    expect(result.ok).toBe(false)
  })
})
