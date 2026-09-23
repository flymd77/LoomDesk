import type { PermissionRequest, PermissionOption } from '../acp/permission'
import type { FeishuClient, FeishuCard } from './feishu'
import { FeishuCardStream, type CardAction } from './feishu-ws'

/**
 * Remote approval loop: when an agent asks for permission and Feishu
 * is configured, post an approval card and park the decision until the
 * human taps Allow / Deny in the group chat (from their phone).
 *
 * The card buttons carry an encoded action value
 * 'approve:<requestId>:<optionId>' / 'deny:<requestId>:<optionId>'.
 * The pending map correlates clicks back to waiting prompts.
 *
 * Timeout: requests resolve deny after PERMISSION_TIMEOUT_MS so an
 * unattended agent cannot stall forever (fail closed).
 */

const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000

interface PendingApproval {
  resolve: (option: PermissionOption) => void
  allowOption: PermissionOption
  denyOption: PermissionOption
  timer: NodeJS.Timeout
  messageId?: string
}

export class ApprovalService {
  private pending = new Map<string, PendingApproval>()
  private cardStream: FeishuCardStream
  private requestSeq = 0

  constructor(
    private readonly feishu: FeishuClient,
    getCredentials: () => { appId: string; appSecret: string } | null
  ) {
    this.cardStream = new FeishuCardStream(getCredentials, (action) =>
      this.onCardAction(action)
    )
  }

  /** Open the card interaction stream (call when Feishu config is ready). */
  start(): void {
    this.cardStream.start()
  }

  /**
   * Ask the human via a Feishu card. Implements the PermissionResolver
   * contract: resolves with the chosen option, throws on timeout.
   */
  askViaCard(request: PermissionRequest): Promise<PermissionOption> {
    const allowOption =
      request.options.find((o) => o.kind === 'allow_once') ??
      request.options.find((o) => o.kind === 'allow_always') ??
      request.options[0]
    const denyOption =
      request.options.find((o) => o.kind === 'reject_once') ??
      request.options.find((o) => o.kind === 'reject_always') ??
      request.options.find((o) => o !== allowOption) ??
      allowOption

    const requestId = `r${++this.requestSeq}-${Date.now().toString(36)}`
    const toolTitle =
      (request.toolCall as { title?: string } | undefined)?.title ?? 'this operation'

    return new Promise<PermissionOption>((resolve) => {
      const timer = setTimeout(() => {
        // Fail closed on timeout.
        this.pending.delete(requestId)
        resolve(denyOption)
      }, PERMISSION_TIMEOUT_MS)

      this.pending.set(requestId, { resolve, allowOption, denyOption, timer })

      const card: FeishuCard = {
        title: '⏸️ Permission needed',
        headerColor: 'orange',
        elements: [
          `**${toolTitle}** needs your approval.`,
          `Session: \`${request.sessionId.slice(0, 8)}\``,
          '' // buttons appended by the sender below
        ]
      }
      void this.sendApprovalCard(requestId, card, allowOption, denyOption)
    })
  }

  /** Send the card with approval buttons wired to encoded action values. */
  private async sendApprovalCard(
    requestId: string,
    card: FeishuCard,
    allow: PermissionOption,
    deny: PermissionOption
  ): Promise<void> {
    try {
      const messageId = await this.feishu.sendCardWithButtons(card, [
        { label: '✅ Allow', value: { actionValue: `approve:${requestId}:${allow.optionId}` }, style: 'primary' },
        { label: '❌ Deny', value: { actionValue: `deny:${requestId}:${deny.optionId}` }, style: 'danger' }
      ])
      const pending = this.pending.get(requestId)
      if (pending) pending.messageId = messageId
    } catch (err) {
      console.error('[approval] failed to send approval card:', err)
      // No card delivered: fail closed quickly instead of hanging.
      const pending = this.pending.get(requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(requestId)
        pending.resolve(pending.denyOption)
      }
    }
  }

  /** Handle one button click from the phone. */
  private async onCardAction(action: CardAction): Promise<void> {
    const [verb, requestId, optionId] = action.actionValue.split(':')
    const pending = this.pending.get(requestId)
    if (!pending) return // stale or already answered

    clearTimeout(pending.timer)
    this.pending.delete(requestId)

    const chosen =
      verb === 'approve'
        ? pending.allowOption
        : pending.denyOption
    // optionId from the card is trusted only as a hint; the mapped
    // option objects above are what the agent offered.
    void optionId

    pending.resolve(chosen)
    try {
      await this.feishu.sendCard({
        title: verb === 'approve' ? '✅ Approved' : '❌ Denied',
        headerColor: verb === 'approve' ? 'green' : 'red',
        elements: [`Decision recorded for request \`${requestId}\`.`]
      })
    } catch {
      // Confirmation card is best-effort.
    }
  }

  /** Drop everything pending (e.g. session disposed). Fails closed. */
  abortAll(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve(pending.denyOption)
    }
    this.pending.clear()
  }
}
