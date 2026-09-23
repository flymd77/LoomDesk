import * as lark from '@larksuiteoapi/node-sdk'

/**
 * Feishu long-connection (WebSocket) card interaction handler.
 *
 * Desktop apps have no public URL for card callbacks, so we use the
 * official WebSocket mode: the SDK keeps a persistent connection to
 * Feishu and card button clicks arrive here as events.
 *
 * Lifecycle: start() opens the connection (idempotent), stop() closes
 * it. The approval callback receives the card's custom action value.
 */

/** What a card button click resolves to. */
export interface CardAction {
  /** Custom value we encoded into the button when sending the card. */
  actionValue: string
  /** Raw event for logging/extension. */
  raw: unknown
}

export class FeishuCardStream {
  private client: lark.WSClient | null = null

  constructor(
    private readonly getCredentials: () => { appId: string; appSecret: string } | null,
    private readonly onAction: (action: CardAction) => Promise<void>
  ) {}

  /** Open the WebSocket connection if credentials exist. Idempotent. */
  start(): void {
    if (this.client) return
    const creds = this.getCredentials()
    if (!creds || !creds.appId || !creds.appSecret) return

    const cardHandler = new lark.CardActionHandler(
      { encryptKey: '', verificationToken: '' },
      async (data: unknown) => {
        await this.handleCardEvent(data)
        // Returning an empty card means "no card update"; the original
        // card stays as-is. We edit cards separately after a decision.
        return {}
      }
    )

    // Card button clicks arrive through the card action handler on the
    // WS client; events (none used today) share the connection.
    this.client = new lark.WSClient({
      appId: creds.appId,
      appSecret: creds.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.warn
    })

    void this.client.start({ eventDispatcher: cardHandler as unknown as lark.EventDispatcher })
  }

  /** Close the connection. Idempotent. */
  stop(): void {
    this.client = null // The SDK has no explicit close; dropping the ref ends polling.
  }

  private async handleCardEvent(data: unknown): Promise<void> {
    // Shape: { action: { value: { ...custom } }, ... } — extract our value.
    const action = (data as { action?: { value?: Record<string, unknown> } })?.action
    const value = action?.value
    if (!value || typeof value !== 'object') return
    const actionValue = typeof value.actionValue === 'string' ? value.actionValue : ''
    if (!actionValue) return
    await this.onAction({ actionValue, raw: data })
  }
}
