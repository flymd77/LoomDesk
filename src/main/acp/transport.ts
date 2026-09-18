import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import {
  decodeMessage,
  encodeMessage,
  type JsonRpcMessage
} from './jsonrpc'

export interface TransportOptions {
  /** Executable to spawn (e.g. "npx" or "qwen"). */
  command: string
  /** Argument list, ACP server flags included. */
  args?: string[]
  /** Extra environment variables merged over process.env. */
  env?: Record<string, string>
  /** Working directory for the agent process (defaults to cwd). */
  cwd?: string
}

export type TransportState = 'idle' | 'running' | 'closed'

/**
 * Line-framed JSON-RPC transport over a child process stdio.
 *
 * Emits:
 *  - 'message'  (msg: JsonRpcMessage)   for every successfully decoded frame
 *  - 'parse-error' (raw: string, err)   for frames that fail to decode
 *  - 'exit' (code: number | null)       when the child process exits
 *  - 'error' (err: Error)               for spawn failures
 *
 * Line-splitting is handled by node:readline which correctly buffers
 * partial chunks (half frames) until a newline arrives.
 */
export class ChildProcessTransport extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private state: TransportState = 'idle'

  constructor(private readonly options: TransportOptions) {
    super()
  }

  getState(): TransportState {
    return this.state
  }

  /** Spawn the agent process and start listening for frames. */
  start(): void {
    if (this.state !== 'idle') {
      throw new Error(`transport already ${this.state}`)
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      // Synchronous spawn failure (invalid arguments).
      this.state = 'closed'
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('error', error)
      throw error
    }

    // Asynchronous spawn failure (missing binary, missing cwd, ...):
    // node emits 'error' after start() returned, so surface it by
    // flipping state and emitting; callers awaiting a handshake will
    // see the transport close without frames and can inspect this.
    child.on('error', (err) => {
      this.state = 'closed'
      this.emit('error', err)
    })

    this.child = child
    this.state = 'running'

    // Surface stderr for diagnostics; ACP servers must not send frames here.
    child.stderr.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString('utf8'))
    })

    child.on('exit', (code) => {
      this.state = 'closed'
      this.emit('exit', code)
    })

    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line: string) => {
      if (line.trim().length === 0) {
        return
      }
      try {
        const msg = decodeMessage(line)
        this.emit('message', msg)
      } catch (err) {
        this.emit('parse-error', line, err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Write one JSON-RPC message as a newline-terminated frame. */
  send(msg: JsonRpcMessage): void {
    if (this.state !== 'running' || !this.child) {
      throw new Error('transport is not running')
    }
    this.child.stdin.write(encodeMessage(msg))
  }

  /**
   * Close the transport. Sends no signal by default (agents exit when
   * stdin closes); pass { force: true } to SIGKILL after stdin close.
   */
  close(opts: { force?: boolean } = {}): void {
    if (this.child) {
      this.child.stdin.end()
      if (opts.force) {
        this.child.kill('SIGKILL')
      }
    }
    if (this.state === 'running') {
      this.state = 'closed'
    }
  }
}
