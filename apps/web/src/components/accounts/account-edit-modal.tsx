'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from './account-form-fields'
import AccountSetupUrls from './account-setup-urls'

interface Props {
  accountId: string
  initialName: string
  initialChannelId: string
  initialLoginChannelId: string | null
  initialLiffId: string | null
  onClose: () => void
  onSaved: () => void
}

// Edit modal — reads current secrets from the secrets-allowed GET endpoint
// (so the user can see "is the secret set?" without exposing it in the list).
// On save, only fields the user actually modified are sent. Empty messaging
// credentials are NOT sent (leave server value as-is) — this lets users edit
// just the Login/LIFF fields without re-entering Messaging credentials.
export default function AccountEditModal({
  accountId,
  initialName,
  initialChannelId,
  initialLoginChannelId,
  initialLiffId,
  onClose,
  onSaved,
}: Props) {
  const [state, setState] = useState<AccountFormState>({
    ...emptyAccountFormState,
    name: initialName,
    channelId: initialChannelId,
    loginChannelId: initialLoginChannelId ?? '',
    liffId: initialLiffId ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Lock background scroll while modal open. Restore on unmount so navigation
  // away mid-edit doesn't leave the page in a non-scrollable state.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const update = (partial: Partial<AccountFormState>) =>
    setState((s) => ({ ...s, ...partial }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Only send fields the user actually changed. Empty string for password-
    // like fields means "no change", not "clear it" — there's no UI affordance
    // to clear credentials, and accidentally clearing them would break prod.
    const payload: Parameters<typeof api.lineAccounts.update>[1] = {}
    if (state.name !== initialName) payload.name = state.name
    if (state.channelAccessToken.trim() !== '') {
      payload.channelAccessToken = state.channelAccessToken.trim()
    }
    if (state.channelSecret.trim() !== '') {
      payload.channelSecret = state.channelSecret.trim()
    }
    // Login/LIFF: empty string means "clear" (set null) — these are
    // configured per-account and clearing is a legitimate operation
    // (e.g. removing a deprecated LIFF). Send the current value as-is.
    const loginIdNext = state.loginChannelId.trim() || null
    const loginIdChanged = loginIdNext !== (initialLoginChannelId ?? null)
    if (loginIdChanged) payload.loginChannelId = loginIdNext

    if (state.loginChannelSecret.trim() !== '') {
      payload.loginChannelSecret = state.loginChannelSecret.trim()
    } else if (loginIdNext === null && initialLoginChannelId !== null) {
      // User cleared the Login Channel ID. Pair with secret-clear so the
      // server's pair-validator doesn't reject the request (it would see
      // id=null + kept-old-secret as inconsistent). Pair-clear is the
      // intended "disable LINE Login on this account" action.
      payload.loginChannelSecret = null
    }

    if ((state.liffId.trim() || null) !== (initialLiffId ?? null)) {
      payload.liffId = state.liffId.trim() || null
    }

    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }

    try {
      const res = await api.lineAccounts.update(accountId, payload)
      if (res.success) {
        onSaved()
        onClose()
      } else {
        setError(res.error || '保存に失敗しました')
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-gray-900">アカウント編集</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">アカウント名</label>
            <input
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          <AccountFormSections
            state={state}
            update={update}
            showMessagingRequired={false}
            channelIdEditable={false}
            defaultOpen={{
              messaging: false,
              // Open Login/LIFF by default in edit mode if they're empty,
              // since "I want to fill these in" is the most common edit
              // intent now that they were previously SQL-only.
              login: !initialLoginChannelId,
              liff: !initialLiffId,
            }}
          />

          <AccountSetupUrls
            liffId={state.liffId.trim() || initialLiffId || null}
            heading="このアカで使う URL（LINE Developers Console に貼る）"
          />

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
