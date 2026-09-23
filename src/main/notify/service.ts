import { BrowserWindow } from 'electron'
import type { SessionStore } from '../store/sessions'
import type { SettingsStore } from '../store/settings'
import { FeishuClient, type FeishuConfig } from './feishu'

/**
 * Notification orchestration: watches session status transitions and
 * mirrors notable ones to Feishu (task finished / waiting for input /
 * permission needed). Also re-broadcasts to local windows.
 *
 * Design notes:
 * - Only *transitions* notify (not every event), so a long turn with
 *   many tool calls pings the phone once.
 * - Sends are fire-and-forget with errors swallowed to the console:
 *   notification failure must never break a chat session.
 */

/** Settings keys under the 'feishu' namespace. */
export interface FeishuSettings extends FeishuConfig {
  enabled: boolean
}

export class NotifyService {
  private feishu: FeishuClient
  private lastStatus = new Map<string, string>()

  constructor(
    private readonly sessions: SessionStore,
    private readonly settings: SettingsStore
  ) {
    this.feishu = new FeishuClient(() => this.feishuSettings())
  }

  /** Exposed for the approval service (same credentials, same client). */
  get feishuClient(): FeishuClient {
    return this.feishu
  }

  /** Current feishu settings, or null when not configured/disabled. */
  feishuSettings(): FeishuSettings | null {
    const raw = this.settings.list('feishu') as Partial<FeishuSettings> | null
    if (!raw || !raw.enabled) return null
    return {
      enabled: true,
      appId: raw.appId ?? '',
      appSecret: raw.appSecret ?? '',
      chatId: raw.chatId ?? '',
      endpoint: raw.endpoint ?? 'feishu'
    }
  }

  /** Persist feishu settings (called from the settings IPC). */
  setFeishuSettings(values: Partial<FeishuSettings>): void {
    for (const [key, value] of Object.entries(values)) {
      this.settings.set(`feishu.${key}`, value)
    }
  }

  /** Connectivity probe for the settings UI. */
  testFeishu(): Promise<{ ok: boolean; message: string }> {
    return this.feishu.test()
  }

  /**
   * Observe one session status transition. Called by the session
   * service whenever it persists a status change.
   */
  async onStatusChange(sessionId: string, status: string): Promise<void> {
    // Integration disabled or unconfigured: tracking stays, sending skips.
    if (!this.feishuSettings()) return
    const previous = this.lastStatus.get(sessionId)
    this.lastStatus.set(sessionId, status)
    if (previous === status) return

    // Only these transitions are phone-worthy.
    const notifyOn = new Set(['idle', 'waiting_permission'])
    if (!notifyOn.has(status)) return

    const record = this.sessions.get(sessionId)
    if (!record) return
    const title = record.title || 'Untitled session'

    const card =
      status === 'waiting_permission'
        ? {
            title: `⏸️ Permission needed — ${title}`,
            elements: [
              `**${title}** is waiting for your approval.`,
              `Workspace: \`${record.workspacePath}\``,
              `Open LoomDesk to approve or deny.`
            ],
            headerColor: 'orange' as const
          }
        : {
            title: `✅ Task finished — ${title}`,
            elements: [
              `**${title}** completed its turn.`,
              `Workspace: \`${record.workspacePath}\``
            ],
            headerColor: 'green' as const
          }

    try {
      await this.feishu.sendCard(card)
    } catch (err) {
      // Never let notifications break the session; surface in console.
      console.error('[notify] feishu send failed:', err)
    }
  }

  /** Remove tracking for a removed session. */
  forgetSession(sessionId: string): void {
    this.lastStatus.delete(sessionId)
  }
}

/** Broadcast one session event to all windows (helper reused by main). */
export function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}
