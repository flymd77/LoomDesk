import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeCachedDatabase, openDatabase, type DbHandle } from '../src/main/store/db'
import { SessionStore } from '../src/main/store/sessions'
import { AgentRegistry } from '../src/main/agents/registry'
import { ApprovalService } from '../src/main/notify/approval'
import { FeishuClient, type FeishuConfig } from '../src/main/notify/feishu'
import type { PermissionRequest, PermissionOption } from '../src/main/acp/permission'

/**
 * Approval loop tests: card delivery, click correlation, timeout and
 * send-failure fail-closed semantics. The Feishu client is mocked at
 * the HTTP boundary with a local server (same pattern as notify tests).
 */

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

const ALLOW: PermissionOption = { optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' }
const DENY: PermissionOption = { optionId: 'opt-deny', name: 'Deny', kind: 'reject_once' }

function makeRequest(): PermissionRequest {
  return {
    sessionId: 'sess-1',
    toolCall: { title: 'Run shell command' },
    options: [ALLOW, DENY]
  }
}

let dir: string
let db: DbHandle

beforeEach(() => {
  closeCachedDatabase()
  dir = mkdtempSync(join(tmpdir(), 'loomdesk-appr-'))
  db = openDatabase(dir)
  new AgentRegistry(db)
  new SessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ApprovalService', () => {
  function makeService(): { approval: ApprovalService; buttons: Array<Record<string, unknown>> } {
    const buttons: Array<Record<string, unknown>> = []
    const feishu = new FeishuClient(() => ({
      appId: 'a',
      appSecret: 's',
      chatId: 'c'
    }))
    vi.spyOn(feishu, 'sendCardWithButtons').mockImplementation(async (_card, btns) => {
      buttons.push(...(btns as Array<Record<string, unknown>>))
      return 'om_1'
    })
    const approval = new ApprovalService(feishu, () => ({ appId: 'a', appSecret: 's' }))
    return { approval, buttons }
  }

  it('sends an approval card with allow and deny buttons', async () => {
    const { approval, buttons } = makeService()
    const promise = approval.askViaCard(makeRequest())
    // Let the fire-and-forget send settle.
    await new Promise((r) => setTimeout(r, 10))
    expect(buttons).toHaveLength(2)

    // Simulate the phone tap on Allow.
    const allowValue = (buttons[0].value as { actionValue: string }).actionValue
    await approval['onCardAction']({ actionValue: allowValue, raw: {} })
    const result = await promise
    expect(result.optionId).toBe('opt-allow')
  })

  it('deny click resolves with the deny option', async () => {
    const { approval, buttons } = makeService()
    const promise = approval.askViaCard(makeRequest())
    await new Promise((r) => setTimeout(r, 10))

    const denyValue = (buttons[1].value as { actionValue: string }).actionValue
    await approval['onCardAction']({ actionValue: denyValue, raw: {} })
    const result = await promise
    expect(result.optionId).toBe('opt-deny')
  })

  it('stale clicks are ignored (no double resolve)', async () => {
    const { approval, buttons } = makeService()
    const promise = approval.askViaCard(makeRequest())
    await new Promise((r) => setTimeout(r, 10))

    const allowValue = (buttons[0].value as { actionValue: string }).actionValue
    await approval['onCardAction']({ actionValue: allowValue, raw: {} })
    // Second click on the same card must not throw or re-resolve.
    await expect(approval['onCardAction']({ actionValue: allowValue, raw: {} })).resolves.toBeUndefined()
    await promise
  })

  it('abortAll fails closed with the deny option', async () => {
    const { approval } = makeService()
    const promise = approval.askViaCard(makeRequest())
    await new Promise((r) => setTimeout(r, 10))

    approval.abortAll()
    const result = await promise
    expect(result.optionId).toBe('opt-deny')
  })

  it('fails closed when the card cannot be delivered', async () => {
    const feishu = new FeishuClient(() => null) // unconfigured -> send throws
    const approval = new ApprovalService(feishu, () => null)
    const result = await approval.askViaCard(makeRequest())
    expect(result.optionId).toBe('opt-deny')
  })

  it('times out and fails closed', async () => {
    vi.useFakeTimers()
    try {
      const { approval } = makeService()
      const promise = approval.askViaCard(makeRequest())
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)
      const result = await promise
      expect(result.optionId).toBe('opt-deny')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PermissionBroker remote resolver integration', () => {
  it('status transitions to waiting_permission during resolution', async () => {
    // Full-loop smoke with a scripted agent that requests permission
    // and expects an answer on its own inbound id space.
    const { ChildProcessTransport } = await import('../src/main/acp/transport')
    const { AcpClient } = await import('../src/main/acp/client')
    const { PermissionBroker } = await import('../src/main/acp/permission')
    const { AcpSession } = await import('../src/main/acp/session')

    const statuses: string[] = []
    const agentScript = `
let buffer = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.setEncoding('utf8');
let pendingPrompt = null;
process.stdin.on('data', (c) => {
  buffer += c;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });
    else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's1' } });
    else if (msg.method === 'session/prompt') {
      pendingPrompt = msg.id;
      send({ jsonrpc: '2.0', id: 'a1', method: 'session/request_permission', params: { sessionId: 's1', options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }] } });
    } else if (msg.id === 'a1' && msg.result) {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'granted:' + msg.result.outcome.optionId } } } });
      send({ jsonrpc: '2.0', id: pendingPrompt, result: { stopReason: 'end_turn' } });
    }
  }
});
`
    const transport = new ChildProcessTransport({
      command: process.execPath,
      args: ['-e', agentScript],
      cwd: tmpdir()
    })
    const client = new AcpClient(transport)
    const broker = new PermissionBroker(client)
    await client.startAndInitialize({ protocolVersion: 1, clientName: 't', clientVersion: '0' })
    const session = await AcpSession.create(client, tmpdir())

    broker.setResolver(async () => {
      statuses.push('waiting_permission')
      return { optionId: 'yes', kind: 'allow_once' }
    })
    broker.attach()

    const stop = await session.prompt([{ type: 'text', text: 'go' }])
    expect(stop.stopReason).toBe('end_turn')
    expect(statuses).toContain('waiting_permission')
    client.close({ force: true })
  })
})
