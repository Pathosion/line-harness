'use client'

import { useState, type ReactNode } from 'react'

// Shared form field building blocks for the LINE account create / edit flows.
// Kept as primitives (not a full form) so the create page (single submit) and
// the edit modal (partial PATCH) can share field rendering without forcing the
// same submit semantics.

export interface AccountFormState {
  name: string
  channelId: string
  channelAccessToken: string
  channelSecret: string
  loginChannelId: string
  loginChannelSecret: string
  liffId: string
}

export const emptyAccountFormState: AccountFormState = {
  name: '',
  channelId: '',
  channelAccessToken: '',
  channelSecret: '',
  loginChannelId: '',
  loginChannelSecret: '',
  liffId: '',
}

// Section: collapsible group of fields. Future "Provider" / "Rich Menu Default"
// sections can be added without touching the page layout, just by rendering
// another <FormSection>.
export function FormSection({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-gray-800">{title}</p>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
        <span className="text-gray-400 text-xs">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="p-4 space-y-3 bg-white">{children}</div>}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  type?: 'text' | 'password'
  hint?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

// Renders the three sections used by both create and edit. Caller provides
// state + setter; this component is presentation-only.
export function AccountFormSections({
  state,
  update,
  showMessagingRequired,
  channelIdEditable = true,
  defaultOpen,
}: {
  state: AccountFormState
  update: (partial: Partial<AccountFormState>) => void
  // create form: messaging fields are required (new account needs them).
  // edit modal: not required (user may only be editing Login/LIFF; passing
  // empty messaging fields means "leave unchanged").
  showMessagingRequired: boolean
  // Channel ID is the immutable identifier of a Messaging API channel on
  // LINE's side — it's never re-issued for the same official account, and
  // the worker has no UPDATE path for `channel_id`. Render it read-only on
  // edit so users don't think they can fix a typo here (they'd need to
  // delete + recreate the row to change Channel ID).
  channelIdEditable?: boolean
  defaultOpen?: { messaging?: boolean; login?: boolean; liff?: boolean }
}) {
  return (
    <div className="space-y-3">
      <FormSection
        title="Messaging API"
        description="LINE 公式アカウント本体の送信用設定（必須）"
        defaultOpen={defaultOpen?.messaging ?? true}
      >
        {channelIdEditable ? (
          <TextField
            label="Channel ID"
            value={state.channelId}
            onChange={(v) => update({ channelId: v })}
            placeholder="123456789"
            required={showMessagingRequired}
          />
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Channel ID</label>
            <input
              value={state.channelId}
              readOnly
              disabled
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Channel ID は変更できません（LINE 側で固定の識別子）
            </p>
          </div>
        )}
        <TextField
          label="Channel Access Token"
          value={state.channelAccessToken}
          onChange={(v) => update({ channelAccessToken: v })}
          required={showMessagingRequired}
          type="password"
          hint={
            showMessagingRequired
              ? undefined
              : '空欄なら現在の値を維持。再発行した場合のみ入力'
          }
        />
        <TextField
          label="Channel Secret"
          value={state.channelSecret}
          onChange={(v) => update({ channelSecret: v })}
          required={showMessagingRequired}
          type="password"
          hint={showMessagingRequired ? undefined : '空欄なら現在の値を維持'}
        />
      </FormSection>

      <FormSection
        title="LINE Login（任意）"
        description="友だち追加 OAuth 導線で使う。後から追加可"
        defaultOpen={defaultOpen?.login ?? false}
      >
        <TextField
          label="Login Channel ID"
          value={state.loginChannelId}
          onChange={(v) => update({ loginChannelId: v })}
          placeholder="2009624792"
          hint="LINE Developers > Login channel > Channel ID"
        />
        <TextField
          label="Login Channel Secret"
          value={state.loginChannelSecret}
          onChange={(v) => update({ loginChannelSecret: v })}
          type="password"
        />
      </FormSection>

      <FormSection
        title="LIFF（任意）"
        description="LIFF page を開くときの ?liffId= で識別。後から追加可"
        defaultOpen={defaultOpen?.liff ?? false}
      >
        <TextField
          label="LIFF ID"
          value={state.liffId}
          onChange={(v) => update({ liffId: v })}
          placeholder="2009624792-XXXXXXXX"
          hint="LINE Developers > Login channel > LIFF タブで作成したものの ID"
        />
      </FormSection>
    </div>
  )
}
