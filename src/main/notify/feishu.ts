/**
 * Minimal Feishu (Lark) open-platform client for the notification and
 * remote-approval flows. Covers only what LoomDesk needs:
 *   - tenant_access_token acquisition with in-memory caching
 *   - sending an interactive card to a chat (group) by chat_id
 *
 * Credentials come from the settings store ('feishu.*' keys) — the
 * client itself stays stateless with respect to configuration.
 * API base defaults to the CN endpoint; an override key supports the
 * Lark (international) endpoint.
 */

const DEFAULT_BASE = 'https://open.feishu.cn'

export interface FeishuConfig {
  appId: string
  appSecret: string
  /** Target chat (group) id to post notifications into. */
  chatId: string
  /** 'feishu' (default) or 'lark' for the international endpoint. */
  endpoint?: 'feishu' | 'lark'
}

export interface FeishuCard {
  /** Card title, shown in the group. */
  title: string
  /** Markdown body lines rendered inside the card. */
  elements: string[]
  /** Optional card color accents the header. */
  headerColor?: 'blue' | 'green' | 'orange' | 'red'
}

interface TokenCache {
  token: string
  expiresAt: number
}

export class FeishuClient {
  private tokenCache: TokenCache | null = null

  constructor(private readonly getConfig: () => FeishuConfig | null) {}

  private base(): string {
    const cfg = this.getConfig()
    return cfg?.endpoint === 'lark' ? 'https://open.larksuite.com' : DEFAULT_BASE
  }

  private config(): FeishuConfig {
    const cfg = this.getConfig()
    if (!cfg || !cfg.appId || !cfg.appSecret || !cfg.chatId) {
      throw new Error('Feishu is not configured (set app id, secret and chat id in settings)')
    }
    return cfg
  }

  /** Tenant access token, cached until shortly before expiry. */
  async token(): Promise<string> {
    const cfg = this.config()
    const now = Date.now()
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token
    }
    const res = await fetch(`${this.base()}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret })
    })
    if (!res.ok) {
      throw new Error(`Feishu token request failed: HTTP ${res.status}`)
    }
    const body = (await res.json()) as { code: number; msg: string; tenant_access_token?: string; expire?: number }
    if (body.code !== 0 || !body.tenant_access_token) {
      throw new Error(`Feishu token error: ${body.code} ${body.msg}`)
    }
    this.tokenCache = {
      token: body.tenant_access_token,
      expiresAt: now + (body.expire ?? 3600) * 1000
    }
    return this.tokenCache.token
  }

  /** Send one interactive card to the configured chat. Returns message id. */
  async sendCard(card: FeishuCard): Promise<string> {
    const cfg = this.config()
    const token = await this.token()
    const payload = {
      receive_id: cfg.chatId,
      msg_type: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: card.title },
          template: card.headerColor ?? 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: { tag: 'lark_md', content: card.elements.join('\n') }
          }
        ]
      })
    }
    const res = await fetch(
      `${this.base()}/open-apis/im/v1/messages?receive_id_type=chat_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Feishu send failed: HTTP ${res.status} ${text.slice(0, 200)}`)
    }
    const body = (await res.json()) as { code: number; msg: string; data?: { message_id?: string } }
    if (body.code !== 0) {
      throw new Error(`Feishu send error: ${body.code} ${body.msg}`)
    }
    return body.data?.message_id ?? ''
  }

  /** Connectivity probe used by the settings UI "Test" button. */
  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.token()
      return { ok: true, message: 'Credentials accepted' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
