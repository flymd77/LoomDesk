import { describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { ChildProcessTransport } from '../../src/main/acp/transport'

/**
 * End-to-end transport tests using a tiny Node child that speaks
 * newline-delimited JSON-RPC over stdio. No real agent involved.
 */
const CHILD_SCRIPT = `
let counter = 0;
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'echo') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.params }) + '\\n');
    } else if (msg.method === 'notify_me') {
      counter += 1;
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'counter', params: { n: counter } }) + '\\n');
    } else if (msg.method === 'bad_frame') {
      process.stdout.write('NOT_JSON\\n');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: 'sent' }) + '\\n');
    } else if (msg.method === 'half_frame') {
      // two half chunks then the terminating newline: readline must reassemble
      process.stdout.write('{"jsonrpc":"2.0","id":');
      setTimeout(() => {
        process.stdout.write('99,"result":"reassembled"}\\n');
      }, 30);
    }
  }
});
`

function makeTransport(): ChildProcessTransport {
  return new ChildProcessTransport({
    command: process.execPath,
    args: ['-e', CHILD_SCRIPT]
  })
}

describe('ChildProcessTransport', () => {
  it('spawns, handles a request/response round-trip, and closes', async () => {
    const transport = makeTransport()
    const messages: unknown[] = []
    transport.on('message', (msg) => messages.push(msg))

    transport.start()
    expect(transport.getState()).toBe('running')

    transport.send({ jsonrpc: '2.0', id: 1, method: 'echo', params: { hello: 'world' } })

    await once(transport, 'message')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { hello: 'world' }
    })

    transport.close()
    expect(transport.getState()).toBe('closed')
  })

  it('delivers notifications emitted by the child', async () => {
    const transport = makeTransport()
    const notifications: Array<{ method: string; params?: unknown }> = []
    transport.on('message', (msg) => {
      if ('method' in msg) notifications.push(msg as { method: string })
    })

    transport.start()
    transport.send({ jsonrpc: '2.0', id: 1, method: 'notify_me' })

    await once(transport, 'message')
    expect(notifications).toHaveLength(1)
    expect(notifications[0].method).toBe('counter')
    expect(notifications[0].params).toEqual({ n: 1 })

    transport.close()
  })

  it('emits parse-error for malformed frames and keeps the stream alive', async () => {
    const transport = makeTransport()
    const parseErrors: string[] = []
    const messages: unknown[] = []
    transport.on('parse-error', (raw: string) => parseErrors.push(raw))
    transport.on('message', (msg) => messages.push(msg))

    transport.start()
    transport.send({ jsonrpc: '2.0', id: 1, method: 'bad_frame' })

    // Wait until the valid frame after the bad one arrives.
    await once(transport, 'message')
    expect(parseErrors).toEqual(['NOT_JSON'])
    expect(messages).toHaveLength(1)

    transport.close()
  })

  it('reassembles half frames split across stdout chunks', async () => {
    const transport = makeTransport()
    const messages: unknown[] = []
    transport.on('message', (msg) => messages.push(msg))

    transport.start()
    transport.send({ jsonrpc: '2.0', id: 1, method: 'half_frame' })

    await once(transport, 'message')
    expect(messages).toEqual([
      { jsonrpc: '2.0', id: 99, result: 'reassembled' }
    ])

    transport.close()
  })

  it('reports child exit with its exit code', async () => {
    const transport = makeTransport()
    transport.start()

    transport.close({ force: true })
    const [code] = (await once(transport, 'exit')) as [number | null]
    expect(transport.getState()).toBe('closed')
    // SIGKILL yields null or -9 depending on platform; both mean "killed".
    expect(code === null || code === -9).toBe(true)
  })

  it('emits error and closes when the cwd does not exist', async () => {
    const transport = new ChildProcessTransport({
      command: process.execPath,
      args: ['-e', ''],
      cwd: '/nonexistent-dir-for-test'
    })
    const errorPromise = once(transport, 'error')
    transport.start()
    const [err] = (await errorPromise) as [Error]
    expect((err as NodeJS.ErrnoException).code).toBe('ENOENT')
    expect(transport.getState()).toBe('closed')
  })

  it('rejects send when not running', () => {
    const transport = makeTransport()
    expect(() =>
      transport.send({ jsonrpc: '2.0', id: 1, method: 'echo' })
    ).toThrow('not running')
  })

  it('rejects double start', () => {
    const transport = makeTransport()
    transport.start()
    transport.close({ force: true })
    expect(() => transport.start()).toThrow(/already (running|closed)/)
  })
})
