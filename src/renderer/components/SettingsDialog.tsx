/**
 * Settings modal: Feishu IM integration. Credentials live in the local
 * settings table only; the Test button validates them against the open
 * platform without sending a message.
 */
import { useEffect, useState } from 'react'
import type { FeishuSettingsDto } from '../../shared/ipc'

interface Props {
  onClose: () => void
}

const EMPTY: FeishuSettingsDto = {
  enabled: false,
  appId: '',
  appSecret: '',
  chatId: '',
  endpoint: 'feishu'
}

export function SettingsDialog({ onClose }: Props): React.JSX.Element {
  const [values, setValues] = useState<FeishuSettingsDto>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.loomdesk.getFeishuSettings().then((s) => {
      if (s) setValues(s)
      setLoaded(true)
    })
  }, [])

  const update = (patch: Partial<FeishuSettingsDto>): void =>
    setValues((prev) => ({ ...prev, ...patch }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.loomdesk.setFeishuSettings(values)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      await window.loomdesk.setFeishuSettings(values)
      const result = await window.loomdesk.testFeishu()
      setTestResult(result.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-5"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">Settings — Feishu notifications</h2>

        {loaded && (
          <>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              Enable Feishu notifications
            </label>

            <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="appId">
              App ID
            </label>
            <input
              id="appId"
              value={values.appId}
              onChange={(e) => update({ appId: e.target.value })}
              placeholder="cli_xxx"
              className="mb-3 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
            />

            <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="secret">
              App Secret
            </label>
            <input
              id="secret"
              type="password"
              value={values.appSecret}
              onChange={(e) => update({ appSecret: e.target.value })}
              className="mb-3 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
            />

            <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="chatId">
              Chat ID (target group)
            </label>
            <input
              id="chatId"
              value={values.chatId}
              onChange={(e) => update({ chatId: e.target.value })}
              placeholder="oc_xxx"
              className="mb-3 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
            />

            <label className="mb-1 block text-xs text-(--color-text-secondary)" htmlFor="endpoint">
              Endpoint
            </label>
            <select
              id="endpoint"
              value={values.endpoint}
              onChange={(e) => update({ endpoint: e.target.value as 'feishu' | 'lark' })}
              className="mb-4 w-full rounded border border-(--color-border) bg-(--color-surface) px-2 py-1.5 text-sm"
            >
              <option value="feishu">feishu.cn (CN)</option>
              <option value="lark">larksuite.com (International)</option>
            </select>

            {testResult && (
              <p
                className={`mb-3 text-xs ${
                  testResult.includes('accepted') ? 'text-(--color-success)' : 'text-(--color-danger)'
                }`}
              >
                {testResult}
              </p>
            )}

            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testing}
                className="rounded border border-(--color-border) px-3 py-1.5 text-sm hover:bg-(--color-surface-hover) disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-surface-hover)"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
