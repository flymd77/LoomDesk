import type { AcpClient } from './client'

/**
 * ACP `session/request_permission` handling.
 *
 * When an agent wants to perform an operation needing approval it calls
 * the client back with a set of options. LoomDesk resolves these via a
 * PermissionBroker: either an automatic policy decision or a human
 * prompt (desktop card today, IM card later).
 *
 * Spec: https://agentclientprotocol.com/protocol/v1/elicitation
 * (permission requests reuse the same inbound-request shape)
 */

/** One selectable option the agent offers. */
export interface PermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
  [key: string]: unknown
}

export interface PermissionRequest {
  sessionId: string
  toolCall?: Record<string, unknown>
  options: PermissionOption[]
  [key: string]: unknown
}

export type PermissionOutcome = Pick<PermissionOption, 'optionId' | 'kind'> & {
  [key: string]: unknown
}

/**
 * How the broker decides when a request arrives.
 *  - 'ask'          always prompt the human resolver
 *  - 'allow_all'    pick the first allow option without prompting
 *  - 'deny_all'     pick the first reject option without prompting
 *
 * Elicitation-style requests (structured questions) are never auto-
 * answered regardless of policy; the broker only handles tool
 * permission requests.
 */
export type PermissionPolicy = 'ask' | 'allow_all' | 'deny_all'

/** The human/AI resolver invoked when the policy says 'ask'. */
export type PermissionResolver = (
  request: PermissionRequest
) => Promise<PermissionOption>

export class PermissionBroker {
  private policy: PermissionPolicy = 'ask'
  private resolver: PermissionResolver | null = null
  private unsubscribe: (() => void) | null = null

  constructor(private readonly client: AcpClient) {}

  /** Current policy (exposed for UI projection). */
  getPolicy(): PermissionPolicy {
    return this.policy
  }

  /** Update the policy; may be called at any time, affects future requests. */
  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy
  }

  /** Install the human resolver used under 'ask' policy. */
  setResolver(resolver: PermissionResolver): void {
    this.resolver = resolver
  }

  /** Start listening for agent permission requests. */
  attach(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.client.onRequest(
      'session/request_permission',
      (params) => this.resolve(params as PermissionRequest)
    )
  }

  /** Stop listening (client close handles this too). */
  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /**
   * Resolve one permission request to the chosen option.
   * The returned value is sent to the agent as the request result.
   */
  private async resolve(request: PermissionRequest): Promise<PermissionOutcome> {
    const options = Array.isArray(request.options) ? request.options : []

    if (this.policy === 'allow_all') {
      const allow = options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')
      if (allow) return allow
      // No allow option: fall through to the human resolver rather than guess.
    }

    if (this.policy === 'deny_all') {
      const deny = options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always')
      if (deny) return deny
    }

    if (!this.resolver) {
      // Fail closed: a missing resolver must never silently approve.
      throw new Error('no permission resolver installed')
    }
    const chosen = await this.resolver(request)
    return chosen
  }
}
