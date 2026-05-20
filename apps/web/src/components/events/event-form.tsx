'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { eventsApi, type EventDetail, type EventSlot } from '@/lib/api'
import ImageUploader from '@/components/shared/image-uploader'
import { useAccount } from '@/contexts/account-context'
import { generateBulkSlots, type BulkSlotInput } from './bulk-slot-generator'

type Tab = 'overview' | 'slots' | 'publish'

const TABS: Array<{ key: Tab; label: string; saveLabel: string; sub: string }> = [
  { key: 'overview', label: '1. 概要', saveLabel: '概要を保存', sub: 'イベント名・場所・詳細を入力' },
  { key: 'slots', label: '2. 予約枠', saveLabel: '', sub: '友だちが選べる日時を追加' },
  { key: 'publish', label: '3. 公開設定', saveLabel: '公開設定を保存', sub: '承認制・リマインダ・公開' },
]

const DEFAULT_DRAFT: EventDetail = {
  id: '',
  name: '',
  venue_name: null,
  venue_url: null,
  image_url: null,
  description: null,
  description_centered: 0,
  max_bookings_per_friend: null,
  requires_approval: 0,
  cancel_deadline_hours_before: null,
  reminder_day_before_enabled: 1,
  reminder_hours_before: null,
  is_published: 0,
  sort_order: 0,
}

export interface EventFormProps {
  accountId: string
  eventId: string | null
}

function jstNow(): Date {
  return new Date(Date.now())
}

function formatJpDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function EventForm({ accountId, eventId }: EventFormProps) {
  const router = useRouter()
  const { selectedAccount, accounts } = useAccount()
  const [tab, setTab] = useState<Tab>('overview')
  const [draft, setDraft] = useState<EventDetail>(DEFAULT_DRAFT)
  const [slots, setSlots] = useState<EventSlot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)

  async function copyValue(v: string) {
    try {
      await navigator.clipboard.writeText(v)
      setCopiedValue(v)
      setTimeout(() => setCopiedValue(null), 2000)
    } catch {
      window.prompt('コピーしてください:', v)
    }
  }

  const liffId = selectedAccount?.liffId ?? null
  const liffUrl = eventId && liffId
    ? `https://liff.line.me/${liffId}/?page=event&id=${eventId}`
    : null

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!eventId) {
        setLoading(false)
        return
      }
      try {
        const [ev, slotsRes] = await Promise.all([
          eventsApi.getEvent(accountId, eventId),
          eventsApi.listSlots(accountId, eventId),
        ])
        if (cancelled) return
        setDraft(ev)
        setSlots(slotsRes.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [accountId, eventId])

  function update<K extends keyof EventDetail>(key: K, value: EventDetail[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function flashToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  async function save(nextTab?: Tab) {
    setSaving(true)
    setError(null)
    try {
      if (!draft.name.trim()) throw new Error('イベント名は必須です')
      if (draft.name.length > 255) throw new Error('イベント名は255字以内で入力してください')
      if (draft.description && draft.description.length > 20000) {
        throw new Error('詳細は20000字以内で入力してください')
      }
      const targetType = draft.target_type ?? 'single'
      let accountIdsArr: string[] = Array.isArray(draft.account_ids)
        ? draft.account_ids
        : typeof draft.account_ids === 'string'
          ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
          : []
      // 現在ログイン中のアカウントは常に含める。保存後 redirect 先 (この
      // accountId scope) で 404 にならないための保証。チェックボックス側でも
      // 外せないが、stale draft 等の保険として save 時にも強制注入する。
      if (targetType === 'multi-account-dedup' && accountId && !accountIdsArr.includes(accountId)) {
        accountIdsArr = [accountId, ...accountIdsArr]
      }
      if (targetType === 'multi-account-dedup' && accountIdsArr.length === 0) {
        throw new Error('複数アカウント横断の場合は対象アカを 1 件以上選択してください')
      }
      const payload: Partial<EventDetail> = {
        name: draft.name,
        venue_name: draft.venue_name,
        venue_url: draft.venue_url,
        image_url: draft.image_url,
        description: draft.description,
        description_centered: draft.description_centered,
        max_bookings_per_friend: draft.max_bookings_per_friend,
        requires_approval: draft.requires_approval,
        cancel_deadline_hours_before: draft.cancel_deadline_hours_before,
        reminder_day_before_enabled: draft.reminder_day_before_enabled,
        reminder_hours_before: draft.reminder_hours_before,
        is_published: draft.is_published,
        sort_order: draft.sort_order,
        target_type: targetType,
        // Worker は account_ids を配列で受け取って内部で JSON.stringify するので、
        // ここでは配列のまま送る (Partial<EventDetail> の union 型を許容)
        account_ids: targetType === 'multi-account-dedup'
          ? (accountIdsArr as unknown as EventDetail['account_ids'])
          : null,
      }
      if (eventId) {
        const updated = await eventsApi.updateEvent(accountId, eventId, payload)
        setDraft(updated)
        flashToast('保存しました')
        if (nextTab) setTab(nextTab)
      } else {
        const created = await eventsApi.createEvent(accountId, payload)
        flashToast('イベントを作成しました。続けて予約枠を追加してください。')
        router.replace(`/events/edit?id=${created.id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function copyLiffUrl() {
    if (!liffUrl) return
    try {
      await navigator.clipboard.writeText(liffUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('コピーしてください:', liffUrl)
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          読み込み中...
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <a href="/events" className="text-blue-600 hover:underline">イベント一覧</a>
        <span className="text-gray-400">/</span>
        <span className="text-gray-700">{eventId ? draft.name || 'イベント編集' : '新規イベント'}</span>
      </div>

      {/* page header */}
      <div className="mb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {eventId ? draft.name || 'イベント編集' : '新規イベント作成'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {eventId ? 'タブで各項目を編集できます' : 'まず「概要」を保存するとイベントが作成されます'}
          </p>
        </div>
        {eventId && (
          <a
            href={`/events/bookings?id=${eventId}`}
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            予約を確認
          </a>
        )}
      </div>

      {/* toast */}
      {toast && (
        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* LIFF URL box(es) */}
      {eventId && draft.is_published === 1 && (() => {
        const targetType = draft.target_type ?? 'single'
        const accountIdsArr: string[] = Array.isArray(draft.account_ids)
          ? draft.account_ids
          : typeof draft.account_ids === 'string'
            ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
            : []

        if (targetType === 'multi-account-dedup') {
          const templateUrl = `https://liff.line.me/{{liff_id}}/?page=event&id=${eventId}`
          const targetAccounts = accounts.filter((a) => accountIdsArr.includes(a.id))
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 space-y-4">
              <div>
                <div className="text-sm font-medium text-blue-900 mb-2">broadcast 用テンプレ URL</div>
                <div className="flex gap-2 items-center">
                  <input
                    readOnly
                    value={templateUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 border border-blue-200 rounded-lg px-3 py-2 text-xs bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => copyValue(templateUrl)}
                    className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {copiedValue === templateUrl ? 'コピー済' : 'コピー'}
                  </button>
                </div>
                <p className="text-xs text-blue-700 mt-2">
                  broadcast 編集で「リンクするイベント」から選ぶと自動挿入。
                  {'{{liff_id}}'} は配信時に各友だちのアカに対応した値に置換されます。
                </p>
              </div>
              <div>
                <div className="text-sm font-medium text-blue-900 mb-2">各アカ固定 URL (QR・LP 直貼り用)</div>
                <div className="space-y-1.5">
                  {targetAccounts.length === 0 && (
                    <div className="text-xs text-amber-700">対象アカが選択されていません</div>
                  )}
                  {targetAccounts.map((a) => {
                    const acct = a as unknown as { liffId?: string | null; name: string; country: string | null }
                    if (!acct.liffId) {
                      return (
                        <div key={a.id} className="text-xs text-amber-700">
                          {acct.country ? acct.country + ' ' : ''}{acct.name}: LIFF ID 未設定
                        </div>
                      )
                    }
                    const url = `https://liff.line.me/${acct.liffId}/?page=event&id=${eventId}`
                    return (
                      <div key={a.id} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 min-w-[80px] truncate">
                          {acct.country ? acct.country + ' ' : ''}{acct.name}
                        </span>
                        <input
                          readOnly
                          value={url}
                          onFocus={(e) => e.currentTarget.select()}
                          className="flex-1 border border-blue-200 rounded-lg px-2 py-1 text-xs bg-white font-mono"
                        />
                        <button
                          onClick={() => copyValue(url)}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                        >
                          {copiedValue === url ? '✓' : 'コピー'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        }

        // single 用 (既存と同じ表示)
        if (liffUrl) {
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="text-sm font-medium text-blue-900 mb-2">予約 URL（友だちに案内する）</div>
              <div className="flex gap-2 items-center">
                <input
                  readOnly
                  value={liffUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 border border-blue-200 rounded-lg px-3 py-2 text-xs bg-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => copyValue(liffUrl)}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {copiedValue === liffUrl ? 'コピー済' : 'コピー'}
                </button>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                この URL をブロードキャストやシナリオで友だちに送ると LINE 内で予約画面が開きます。
              </p>
            </div>
          )
        }
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
            LIFF ID が未設定のため予約 URL を生成できません。LINE アカウント設定で LIFF ID を登録してください。
          </div>
        )
      })()}
      {eventId && draft.is_published === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
          現在「下書き」状態です。公開設定タブで「公開する」を ON にすると友だち向けの予約 URL が表示されます。
        </div>
      )}

      {/* main card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* tab nav */}
        <div className="flex border-b border-gray-200">
          {TABS.map((t) => {
            const active = tab === t.key
            const disabled = t.key !== 'overview' && !eventId
            return (
              <button
                key={t.key}
                disabled={disabled}
                onClick={() => !disabled && setTab(t.key)}
                title={disabled ? 'まず「概要」を保存してください' : undefined}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  active
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : disabled
                    ? 'border-transparent text-gray-300 cursor-not-allowed'
                    : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div>{t.label}</div>
                <div className="text-xs font-normal mt-0.5 opacity-80">{t.sub}</div>
              </button>
            )
          })}
        </div>

        {/* tab body */}
        <div className="p-6">
          {tab === 'overview' && <OverviewTab draft={draft} update={update} accounts={accounts} currentAccountId={accountId} />}
          {tab === 'slots' && (
            <SlotsTab
              accountId={accountId}
              eventId={eventId}
              slots={slots}
              setSlots={setSlots}
            />
          )}
          {tab === 'publish' && <PublishTab draft={draft} update={update} />}
        </div>

        {/* tab footer */}
        {tab !== 'slots' && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {tab === 'overview' && !eventId && '保存するとイベントが作成され、予約枠タブに進みます'}
              {tab === 'overview' && eventId && '変更を「概要を保存」で確定します'}
              {tab === 'publish' && '「公開する」ON で友だちに予約 URL を案内できます'}
            </div>
            <div className="flex gap-2">
              {tab === 'overview' && eventId && (
                <button
                  onClick={() => save('slots')}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-white disabled:opacity-50"
                >
                  保存して次へ →
                </button>
              )}
              <button
                onClick={() => save()}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : tab === 'overview' && !eventId ? 'イベントを作成' : TABS.find((x) => x.key === tab)?.saveLabel ?? '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// Tab 1: Overview
// ----------------------------------------------------------------

function OverviewTab({
  draft,
  update,
  accounts,
  currentAccountId,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
  accounts: Array<{ id: string; name: string; country: string | null; isActive: boolean }>
  currentAccountId: string
}) {
  const descLen = (draft.description ?? '').length
  const targetType = draft.target_type ?? 'single'
  const accountIds: string[] = Array.isArray(draft.account_ids)
    ? draft.account_ids
    : typeof draft.account_ids === 'string'
      ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
      : []
  const activeAccounts = accounts.filter((a) => a.isActive)
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          イベント名 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => update('name', e.target.value)}
          maxLength={255}
          placeholder="例: 第1回 AAA 説明会"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">開催場所</label>
          <input
            type="text"
            value={draft.venue_name ?? ''}
            onChange={(e) => update('venue_name', e.target.value || null)}
            placeholder="例: 渋谷ベース 3F"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">会場 URL</label>
          <input
            type="url"
            value={draft.venue_url ?? ''}
            onChange={(e) => update('venue_url', e.target.value || null)}
            placeholder="https://..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <ImageUploader
          mode="url"
          value={draft.image_url ? { mode: 'url', url: draft.image_url } : null}
          onChange={(v) => update('image_url', v?.mode === 'url' ? v.url : null)}
          label="イベント画像"
        />
      </div>
      <div>
        <label className="flex justify-between items-center text-sm font-medium text-gray-700 mb-1.5">
          <span>イベント詳細</span>
          <span className={`text-xs ${descLen > 20000 ? 'text-red-600' : 'text-gray-500'}`}>
            {descLen.toLocaleString()} / 20,000
          </span>
        </label>
        <textarea
          value={draft.description ?? ''}
          onChange={(e) => update('description', e.target.value || null)}
          rows={8}
          placeholder="開催趣旨、注意事項、持ち物などを記載..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={draft.description_centered === 1}
            onChange={(e) => update('description_centered', e.target.checked ? 1 : 0)}
            className="rounded border-gray-300"
          />
          詳細を中央揃えで表示
        </label>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          1 人あたり予約回数
        </label>
        <select
          value={draft.max_bookings_per_friend ?? 'unlimited'}
          onChange={(e) =>
            update(
              'max_bookings_per_friend',
              e.target.value === 'unlimited' ? null : Number(e.target.value),
            )
          }
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="unlimited">制限なし</option>
          <option value="1">1 回まで</option>
          <option value="2">2 回まで</option>
          <option value="3">3 回まで</option>
          <option value="5">5 回まで</option>
        </select>
      </div>

      {/* 公開対象 */}
      <div className="border-t border-gray-200 pt-5">
        <div className="text-sm font-medium text-gray-700 mb-2">公開対象</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => update('target_type', 'single')}
            className={`p-3 border-2 rounded-lg text-left ${
              targetType === 'single' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-bold">単一アカウント</div>
            <div className="text-xs text-gray-600">1 つの LINE アカで運用</div>
          </button>
          <button
            type="button"
            onClick={() => {
              update('target_type', 'multi-account-dedup')
              // single → multi 切替時: 編集中の admin account を account_ids[0]
              // sentinel として自動セット。active 一覧の先頭ではなく実際に
              // 編集している admin の account にしないと、保存後にその admin
              // が自分のイベントを見られなくなる (404)。
              if (accountIds.length === 0) {
                const seed = currentAccountId || activeAccounts[0]?.id || ''
                if (seed) {
                  update('account_ids', [seed] as unknown as EventDetail['account_ids'])
                }
              }
            }}
            className={`p-3 border-2 rounded-lg text-left ${
              targetType === 'multi-account-dedup' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-bold">複数アカウント横断</div>
            <div className="text-xs text-gray-600">重複なし配信に対応</div>
          </button>
        </div>

        {targetType === 'multi-account-dedup' && (
          <div className="space-y-1.5">
            <div className="text-xs text-gray-600">対象アカ（重複なし配信）</div>
            {activeAccounts.length === 0 && (
              <div className="text-sm text-gray-500 italic p-2">アクティブなアカウントがありません</div>
            )}
            {activeAccounts.map((a) => {
              // 現在ログイン中のアカウントは外せない (外すと保存後 redirect が
              // 即 404 になる)。target_type 切替時に sentinel seed されている
              // ことの保護も兼ねる。
              const isCurrent = a.id === currentAccountId
              const checked = accountIds.includes(a.id) || isCurrent
              return (
                <label
                  key={a.id}
                  className={`flex items-center gap-2 p-2 border border-gray-200 rounded-lg ${isCurrent ? 'opacity-90 bg-gray-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                  title={isCurrent ? '現在ログイン中のアカウントは必須です' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isCurrent}
                    onChange={(e) => {
                      if (isCurrent) return
                      const next = e.target.checked
                        ? [...accountIds, a.id]
                        : accountIds.filter((x) => x !== a.id)
                      update('account_ids', next as unknown as EventDetail['account_ids'])
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">
                    {a.country ? a.country + ' ' : ''}{a.name}
                    {isCurrent && <span className="ml-1 text-[10px] text-gray-500">(現アカ・必須)</span>}
                  </span>
                </label>
              )
            })}
            <div className="text-xs text-gray-500 mt-1">{accountIds.length} 件選択中</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// Tab 2: Slots
// ----------------------------------------------------------------

function SlotsTab({
  accountId,
  eventId,
  slots,
  setSlots,
}: {
  accountId: string
  eventId: string | null
  slots: EventSlot[]
  setSlots: (s: EventSlot[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  if (!eventId) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        まず「概要」タブで保存してから予約枠を追加してください。
      </div>
    )
  }

  async function refresh() {
    if (!eventId) return
    const res = await eventsApi.listSlots(accountId, eventId)
    setSlots(res.items)
  }

  async function deleteSlot(slotId: string) {
    if (!eventId) return
    if (!confirm('この枠を削除しますか？（既存予約があると削除できません）')) return
    setBusy(true)
    setErr(null)
    try {
      await eventsApi.deleteSlot(accountId, eventId, slotId)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(s: EventSlot) {
    if (!eventId) return
    setBusy(true)
    try {
      await eventsApi.updateSlot(accountId, eventId, s.id, { is_active: s.is_active === 1 ? 0 : 1 })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center justify-between">
        <div className="text-sm text-gray-600">{slots.length} 件の予約枠</div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            ＋ 枠を追加
          </button>
          <button
            onClick={() => setShowBulk(true)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            📅 一括追加
          </button>
        </div>
      </div>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-3 text-sm">{err}</div>}
      {slots.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
          予約枠がありません。「＋ 枠を追加」または「📅 一括追加」から作成してください。
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium">日時</th>
                <th className="text-left px-3 py-2 font-medium">定員</th>
                <th className="text-left px-3 py-2 font-medium">予約数</th>
                <th className="text-left px-3 py-2 font-medium">状態</th>
                <th className="text-right px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id} className="border-t border-gray-200">
                  <td className="px-3 py-2 text-gray-800">
                    {formatJpDateTime(s.starts_at)} 〜 {formatJpDateTime(s.ends_at).slice(-5)}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{s.capacity ?? '無制限'}</td>
                  <td className="px-3 py-2 text-gray-700">{s.active_count ?? 0}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleActive(s)}
                      disabled={busy}
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        s.is_active === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {s.is_active === 1 ? '有効' : '停止'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteSlot(s.id)}
                      disabled={busy || (s.active_count ?? 0) > 0}
                      title={(s.active_count ?? 0) > 0 ? '既存予約があるため削除できません' : '削除'}
                      className="text-xs text-red-600 hover:underline disabled:opacity-30 disabled:no-underline"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddSlotDialog
          onClose={() => setShowAdd(false)}
          onSubmit={async (s) => {
            await eventsApi.createSlots(accountId, eventId, [s])
            await refresh()
            setShowAdd(false)
          }}
        />
      )}
      {showBulk && (
        <BulkSlotDialog
          onClose={() => setShowBulk(false)}
          onSubmit={async (input) => {
            const generated = generateBulkSlots(input)
            if (generated.length === 0) {
              alert('生成される枠が0件でした。条件を確認してください。')
              return
            }
            if (!confirm(`${generated.length}件の枠を生成します。よろしいですか？`)) return
            await eventsApi.createSlots(accountId, eventId, generated)
            await refresh()
            setShowBulk(false)
          }}
        />
      )}
    </div>
  )
}

function AddSlotDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (s: { starts_at: string; ends_at: string; capacity: number | null }) => Promise<void>
}) {
  const todayJst = new Date(jstNow().getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const [date, setDate] = useState(todayJst)
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('12:00')
  const [capacity, setCapacity] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const s = jstHHMMToUtcIso(date, startTime)
      const e = jstHHMMToUtcIso(date, endTime)
      if (s >= e) throw new Error('開始時刻 < 終了時刻')
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('定員は1以上の整数')
      await onSubmit({ starts_at: s, ends_at: e, capacity: cap })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900">予約枠を追加</h3>
        {err && <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-sm">{err}</div>}
        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">日付（JST）</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-sm font-medium text-gray-700">開始</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label>
              <span className="text-sm font-medium text-gray-700">終了</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">定員（空欄=無制限）</span>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            追加
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkSlotDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: BulkSlotInput) => Promise<void>
}) {
  const todayJst = new Date(jstNow().getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const [start, setStart] = useState(todayJst)
  const [end, setEnd] = useState(todayJst)
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [patterns, setPatterns] = useState([{ start: '10:00', end: '11:00' }])
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggleWeekday(d: number) {
    setWeekdays((ws) => (ws.includes(d) ? ws.filter((x) => x !== d) : [...ws, d]))
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('定員は1以上の整数')
      await onSubmit({
        start_date: start,
        end_date: end,
        weekdays,
        time_patterns: patterns.filter((p) => p.start && p.end && p.start < p.end),
        capacity: cap,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900">予約枠の一括追加</h3>
        {err && <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg mb-3 text-sm">{err}</div>}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-sm font-medium text-gray-700">開始日</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="text-sm font-medium text-gray-700">終了日</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </label>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700 block mb-1.5">曜日</span>
            <div className="flex gap-1.5">
              {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  className={`flex-1 px-2 py-2 text-sm border rounded-lg ${
                    weekdays.includes(i)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700 block mb-1.5">時刻パターン</span>
            {patterns.map((p, i) => (
              <div key={i} className="flex gap-2 mb-1.5 items-center">
                <input
                  type="time"
                  value={p.start}
                  onChange={(e) => setPatterns((ps) => ps.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <span className="text-gray-500">〜</span>
                <input
                  type="time"
                  value={p.end}
                  onChange={(e) => setPatterns((ps) => ps.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                {patterns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPatterns((ps) => ps.filter((_, j) => j !== i))}
                    className="text-red-600 px-2"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPatterns((ps) => [...ps, { start: '14:00', end: '15:00' }])}
              className="text-sm text-blue-600 hover:underline"
            >
              ＋ パターン追加
            </button>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">定員（各枠共通・空欄=無制限）</span>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            生成
          </button>
        </div>
      </div>
    </div>
  )
}

function jstHHMMToUtcIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const totalMin = h * 60 + m - 9 * 60
  const [y, mo, d] = date.split('-').map(Number)
  const t = Date.UTC(y, mo - 1, d) + totalMin * 60_000
  return new Date(t).toISOString()
}

// ----------------------------------------------------------------
// Tab 3: Publish settings
// ----------------------------------------------------------------

function PublishTab({
  draft,
  update,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
}) {
  return (
    <div className="space-y-5">
      <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
        <input
          type="checkbox"
          checked={draft.requires_approval === 1}
          onChange={(e) => update('requires_approval', e.target.checked ? 1 : 0)}
          className="mt-0.5 rounded border-gray-300"
        />
        <div>
          <div className="text-sm font-medium text-gray-900">承認制</div>
          <div className="text-xs text-gray-500 mt-0.5">
            ON: 友だちが予約しても運営が「承認」するまで未確定<br />
            OFF: 定員空きがあれば即時確定
          </div>
        </div>
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          キャンセル期限（友だち側）
        </label>
        <select
          value={draft.cancel_deadline_hours_before ?? 'disabled'}
          onChange={(e) =>
            update(
              'cancel_deadline_hours_before',
              e.target.value === 'disabled' ? null : Number(e.target.value),
            )
          }
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="disabled">不可（運営に LINE 連絡）</option>
          <option value="0">直前まで可</option>
          <option value="6">6 時間前まで</option>
          <option value="12">12 時間前まで</option>
          <option value="24">24 時間前まで</option>
          <option value="48">48 時間前まで</option>
        </select>
      </div>

      <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
        <input
          type="checkbox"
          checked={draft.reminder_day_before_enabled === 1}
          onChange={(e) => update('reminder_day_before_enabled', e.target.checked ? 1 : 0)}
          className="mt-0.5 rounded border-gray-300"
        />
        <div>
          <div className="text-sm font-medium text-gray-900">前日リマインダ</div>
          <div className="text-xs text-gray-500 mt-0.5">前日 18:00 JST に LINE で通知</div>
        </div>
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          開始 N 時間前リマインダ
        </label>
        <select
          value={draft.reminder_hours_before ?? 'off'}
          onChange={(e) =>
            update('reminder_hours_before', e.target.value === 'off' ? null : Number(e.target.value))
          }
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="off">送信しない</option>
          <option value="1">1 時間前</option>
          <option value="2">2 時間前</option>
          <option value="3">3 時間前</option>
          <option value="6">6 時間前</option>
          <option value="24">24 時間前</option>
        </select>
      </div>

      <hr className="border-gray-200" />

      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">公開状態</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => update('is_published', 0)}
            className={`p-3 border-2 rounded-lg text-left transition-colors ${
              draft.is_published === 0
                ? 'border-gray-700 bg-gray-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-bold text-gray-900">下書き</div>
            <div className="text-xs text-gray-600 mt-0.5">友だちには見えない</div>
          </button>
          <button
            type="button"
            onClick={() => update('is_published', 1)}
            className={`p-3 border-2 rounded-lg text-left transition-colors ${
              draft.is_published === 1
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 bg-white hover:border-green-300'
            }`}
          >
            <div className="text-sm font-bold text-gray-900">公開する</div>
            <div className="text-xs text-gray-600 mt-0.5">予約 URL が有効になる</div>
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {draft.is_published === 1
            ? '✓ 保存後、友だちに「予約 URL」を案内できます。'
            : '保存しても友だちには表示されません。'}
        </p>
      </div>
    </div>
  )
}
