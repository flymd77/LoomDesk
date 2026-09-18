import { describe, expect, it, vi } from 'vitest'
import { ChildProcessTransport } from '../../src/main/acp/transport'
import { AcpClient } from '../../src/main/acp/client'
import { PermissionBroker, type PermissionRequest } from '../../src/main/acp/permission'

/**
 * Scripted agent that, on `trigger_permission`, calls back into the
 * client with `session/request_permission`. The inbound request uses an
 * id from the agent's own space ("a1", "a2", ...), mirroring real ACP
 * where agent-initiated request ids are independent of client ids.
 * The agent reports the client's final answer back inside the result of
 * the original trigger request so tests assert exactly what the agent saw.
 */
function agentScript(optionsJson: string): string {
  return `
let buffer = '';
const send = (obj) => process.stdout.write(JSON.stringify(obj) + String.fromCharCode(10));
const OPTIONS = ${optionsJson};
let inboundId = 0;
let pendingTriggerId = null;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf(String.fromCharCode(10))) >= 0) {
    const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } });
    } else if (msg.method === 'trigger_permission') {
      pendingTriggerId = msg.id;
      inboundId += 1;
      send({
        jsonrpc: '2.0', id: 'a' + inboundId, method: 'session/request_permission',
        params: { sessionId: 's1', options: OPTIONS }
      });
    } else if (typeof msg.id === 'string' && msg.id[0] === 'a') {
      // Client's answer to our inbound permission request.
      const answer = msg.result ? msg.result.optionId : ('error:' + msg.error.message);
      send({ jsonrpc: '2.0', id: pendingTriggerId, result: { answered: answer } });
    }
  }
});
`
}

const STANDARD_OPTIONS = JSON.stringify([
  { optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'opt-reject', name: 'Reject', kind: 'reject_once' }
])

async function makeBroker(optionsJson = STANDARD_OPTIONS): Promise<{
  client: AcpClient
  broker: PermissionBroker
}> {
  const transport = new ChildProcessTransport({
    command: process.execPath,
    args: ['-e', agentScript(optionsJson)]
  })
  const client = new AcpClient(transport)
  await client.startAndInitialize({ protocolVersion: 1, clientName: 't', clientVersion: '0' })
  const broker = new PermissionBroker(client)
  broker.attach()
  return { client, broker }
}

/** Trigger the agent's permission callback; resolves with what the agent saw. */
async function trigger(client: AcpClient): Promise<{ answered: unknown }> {
  return (await client.request('trigger_permission')) as { answered: unknown }
}

describe('PermissionBroker', () => {
  it('uses the resolver under ask policy; agent sees the chosen option', async () => {
    const { client, broker } = await makeBroker()
    broker.setPolicy('ask')
    const resolver = vi
      .fn()
      .mockResolvedValue({ optionId: 'opt-reject', name: 'Reject', kind: 'reject_once' })
    broker.setResolver(resolver)

    const saw = await trigger(client)

    expect(resolver).toHaveBeenCalledTimes(1)
    const req = resolver.mock.calls[0][0] as PermissionRequest
    expect(req.sessionId).toBe('s1')
    expect(req.options).toHaveLength(2)
    expect(saw.answered).toBe('opt-reject')
    client.close({ force: true })
  })

  it('allow_all policy auto-picks the first allow option without prompting', async () => {
    const { client, broker } = await makeBroker()
    broker.setPolicy('allow_all')
    const resolver = vi.fn()
    broker.setResolver(resolver)

    const saw = await trigger(client)

    expect(resolver).not.toHaveBeenCalled()
    expect(saw.answered).toBe('opt-allow')
    client.close({ force: true })
  })

  it('deny_all policy auto-picks the first reject option without prompting', async () => {
    const { client, broker } = await makeBroker()
    broker.setPolicy('deny_all')
    const resolver = vi.fn()
    broker.setResolver(resolver)

    const saw = await trigger(client)

    expect(resolver).not.toHaveBeenCalled()
    expect(saw.answered).toBe('opt-reject')
    client.close({ force: true })
  })

  it('allow_all falls back to the resolver when no allow option exists', async () => {
    const { client, broker } = await makeBroker(
      JSON.stringify([{ optionId: 'r1', name: 'Reject', kind: 'reject_once' }])
    )
    broker.setPolicy('allow_all')
    const resolver = vi
      .fn()
      .mockResolvedValue({ optionId: 'r1', name: 'Reject', kind: 'reject_once' })
    broker.setResolver(resolver)

    const saw = await trigger(client)

    expect(resolver).toHaveBeenCalledTimes(1)
    expect(saw.answered).toBe('r1')
    client.close({ force: true })
  })

  it('fails closed when policy is ask and no resolver is installed', async () => {
    const { client } = await makeBroker()
    // Policy defaults to 'ask'; no resolver installed.
    // The agent replies with 'error:...' because the client answered
    // the inbound request with a JSON-RPC error.
    const saw = await trigger(client)
    expect(String(saw.answered)).toMatch(/^error:/)
    client.close({ force: true })
  })

  it('policy changes take effect immediately between requests', async () => {
    const { client, broker } = await makeBroker()
    broker.setPolicy('deny_all')
    const resolver = vi.fn()
    broker.setResolver(resolver)

    const first = await trigger(client)
    expect(resolver).not.toHaveBeenCalled()
    expect(first.answered).toBe('opt-reject')

    broker.setPolicy('ask')
    resolver.mockResolvedValue({ optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' })
    const second = await trigger(client)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(second.answered).toBe('opt-allow')
    client.close({ force: true })
  })

  it('detach stops answering permission requests', async () => {
    const { client, broker } = await makeBroker()
    broker.setPolicy('allow_all')
    broker.detach()

    // With no handler the inbound request stays unanswered; the trigger
    // request therefore never resolves. Race it against a short timer.
    const outcome = await Promise.race([
      trigger(client).then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('unanswered'), 300))
    ])
    expect(outcome).toBe('unanswered')
    client.close({ force: true })
  })
})
