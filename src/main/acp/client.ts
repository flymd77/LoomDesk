import type { ChildProcessTransport } from './transport'
import {
  isJsonRpcErrorResponse,
  isJsonRpcRequest,
  JsonRpcErrorCode,
  type JsonRpcErrorObject,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest
} from './jsonrpc'

/** Client capabilities declared during `initialize`. */
export interface ClientCapabilities {
  /**
   * Client can load prior sessions via `session/load`.
   * Kept explicit so agents can adapt their resume behavior.
   */
  loadSession?: boolean
}

/** Parameters for the ACP `initialize` handshake. */
export interface InitializeParams {
  /** Protocol version the client implements (v1 as of this writing). */
  protocolVersion: number
  /** Human-readable client name. */
  clientName: string
  /** Client version string. */
  clientVersion: string
  /** Optional capability flags. */
  capabilities?: ClientCapabilities
}

/** Response returned by the agent for `initialize`. */
export interface InitializeResult {
  protocolVersion: number
  agentName?: string
  agentVersion?: string
  capabilities?: Record<string, unknown>
  authMethods?: Array<Record<string, unknown>>
}

/** Error thrown when a pending request fails, times out, or the transport dies. */
export class AcpRequestError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly data?: unknown
  ) {
    super(message)
    this.name = 'AcpRequestError'
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (err: AcpRequestError) => void
  timer: NodeJS.Timeout
}

export interface AcpClientOptions {
  /** Default timeout in ms for requests (default 60s). */
  requestTimeoutMs?: number
}

/**
 * ACP client session bound to one agent child process.
 *
 * Layers on top of ChildProcessTransport:
 *  - request/response id correlation with timeout
 *  - inbound request routing (agent -> client calls such as permission prompts)
 *  - notification fan-out for `session/update` streams
 *
 * The class stays transport-agnostic in its message handling; only
 * start()/close() touch the underlying process.
 */
export class AcpClient {
  private nextId = 1
  private readonly pending = new Map<number | string, PendingRequest>()
  private readonly requestTimeoutMs: number

  constructor(
    private readonly transport: ChildProcessTransport,
    options: AcpClientOptions = {}
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000
    transport.on('message', (msg: JsonRpcMessage) => this.handleMessage(msg))
    transport.on('exit', () => this.rejectAllPending('agent process exited'))
  }

  /** Spawn the agent and complete the ACP initialize handshake. */
  async startAndInitialize(params: InitializeParams): Promise<InitializeResult> {
    this.transport.start()
    const result = (await this.request('initialize', params)) as InitializeResult
    if (typeof result?.protocolVersion !== 'number') {
      throw new AcpRequestError(
        'initialize response missing protocolVersion',
        JsonRpcErrorCode.InvalidRequest
      )
    }
    return result
  }

  /** Send a JSON-RPC request and await its correlated response. */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AcpRequestError(`request '${method}' timed out`, null))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    this.transport.send({ jsonrpc: '2.0', id, method, params })
    return promise
  }

  /** Send a fire-and-forget notification. */
  notify(method: string, params?: unknown): void {
    this.transport.send({ jsonrpc: '2.0', method, params })
  }

  /**
   * Register a handler for inbound notifications with the given method.
   * Returns an unsubscribe function.
   */
  onNotification(
    method: string,
    handler: (params: unknown, raw: JsonRpcNotification) => void
  ): () => void {
    const listener = (msg: JsonRpcMessage): void => {
      if ('method' in msg && msg.method === method && !('id' in msg)) {
        handler((msg as JsonRpcNotification).params, msg as JsonRpcNotification)
      }
    }
    this.transport.on('message', listener)
    return () => {
      this.transport.off('message', listener)
    }
  }

  /**
   * Register a handler for inbound requests (agent -> client), e.g.
   * `session/request_permission` or `fs/read_text_file`.
   * The handler's return value becomes the success result; throw to
   * answer with a JSON-RPC error. Returns an unsubscribe function.
   */
  onRequest(
    method: string,
    handler: (params: unknown, raw: JsonRpcRequest) => unknown | Promise<unknown>
  ): () => void {
    const listener = (msg: JsonRpcMessage): void => {
      if (!isJsonRpcRequest(msg) || msg.method !== method) {
        return
      }
      void Promise.resolve()
        .then(() => handler(msg.params, msg))
        .then(
          (result) => {
            this.transport.send({ jsonrpc: '2.0', id: msg.id, result })
          },
          (err: unknown) => {
            const error: JsonRpcErrorObject =
              err instanceof AcpRequestError
                ? { code: err.code ?? JsonRpcErrorCode.InternalError, message: err.message }
                : {
                    code: JsonRpcErrorCode.InternalError,
                    message: err instanceof Error ? err.message : String(err)
                  }
            this.transport.send({ jsonrpc: '2.0', id: msg.id, error })
          }
        )
    }
    this.transport.on('message', listener)
    return () => {
      this.transport.off('message', listener)
    }
  }

  /** Close the underlying transport; all pending requests are rejected. */
  close(opts: { force?: boolean } = {}): void {
    this.transport.close(opts)
    this.rejectAllPending('client closed')
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (isJsonRpcRequest(msg)) {
      // Outbound-scoped request handlers are registered via onRequest;
      // responses carry no method, so an inbound request without a handler
      // falls through here. Nothing to do — no reply keeps behavior honest.
      return
    }
    if ('method' in msg) {
      return // notifications are handled by onNotification listeners
    }
    // Response path: correlate by id.
    const id = msg.id
    if (id === null) {
      return // error response without an id cannot be correlated
    }
    const entry = this.pending.get(id)
    if (!entry) {
      return // late or unknown response; ignore rather than guess
    }
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (isJsonRpcErrorResponse(msg)) {
      entry.reject(new AcpRequestError(msg.error.message, msg.error.code, msg.error.data))
    } else {
      entry.resolve(msg.result)
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new AcpRequestError(reason, null))
      this.pending.delete(id)
    }
  }
}
