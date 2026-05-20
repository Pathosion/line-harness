'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { bookingApi, type BookingMenu } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const EMPTY: Partial<BookingMenu> = {
  name: '',
  category_label: '',
  description: '',
  duration_minutes: 60,
  buffer_after_minutes: 0,
  base_price: 5000,
  sort_order: 0,
  is_active: 1,
}

export default function MenusPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<BookingMenu[]>([])
  const [editing, setEditing] = useState<Partial<BookingMenu> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // アカウント切替時は前 account の menus が表示・操作可能なまま残らないよう
    // 先にクリア。fetch 失敗でも cross-account の操作事故が起きない。
    setItems([])
    try {
      const r = await bookingApi.listMenus(selectedAccountId)
      setItems(r.menus)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  async function save(m: Partial<BookingMenu>) {
    if (!selectedAccountId) return
    if (m.id) {
      await bookingApi.updateMenu(selectedAccountId, m.id, m)
    } else {
      await bookingApi.createMenu(selectedAccountId, m)
    }
    setEditing(null)
    await load()
  }

  async function remove(id: string) {
    if (!selectedAccountId) return
    if (!confirm('このメニューを削除しますか？（既存予約は維持されます）')) return
    await bookingApi.deleteMenu(selectedAccountId, id)
    await load()
  }

  return (
    <div>
      <Header
        title="メニュー"
        description="予約メニューの登録・編集"
        action={
          <button
            onClick={() => setEditing(EMPTY)}
            disabled={!selectedAccountId}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規メニュー
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!selectedAccountId ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          サイドバーでアカウントを選択してください
        </div>
      ) : loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          読み込み中…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-sm text-gray-500">
          まだメニューがありません。右上の「+ 新規メニュー」から追加してください。
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">カテゴリ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">所要</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">料金</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">並び順</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">有効</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">{m.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {m.category_label ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-xs">{m.category_label}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                      {m.duration_minutes}分
                      {m.buffer_after_minutes > 0 && (
                        <span className="text-xs text-gray-400 ml-1">+{m.buffer_after_minutes}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">¥{m.base_price.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-500">{m.sort_order}</td>
                    <td className="px-4 py-3 text-center">
                      {m.is_active ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-green-100 text-green-800 text-xs">ON</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-500 text-xs">OFF</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2 text-xs">
                        <button onClick={() => setEditing(m)} className="text-blue-600 hover:underline">編集</button>
                        <Link href={`/booking/menus/staff?menu_id=${m.id}`} className="text-blue-600 hover:underline">
                          スタッフ割当
                        </Link>
                        <button onClick={() => remove(m.id)} className="text-red-600 hover:underline">削除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <Modal menu={editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Modal({
  menu,
  onSave,
  onClose,
}: {
  menu: Partial<BookingMenu>
  onSave: (m: Partial<BookingMenu>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<BookingMenu>>(menu)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function set<K extends keyof BookingMenu>(k: K, v: BookingMenu[K] | string) {
    setForm({ ...form, [k]: v })
  }

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await onSave(form)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold">{form.id ? 'メニュー編集' : '新規メニュー'}</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <Field label="名前" required>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={(e) => set('name', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: カット"
            />
          </Field>
          <Field label="カテゴリ">
            <input
              type="text"
              value={form.category_label ?? ''}
              onChange={(e) => set('category_label', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="例: カット / カラー / パーマ"
            />
          </Field>
          <Field label="説明">
            <textarea
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
              rows={2}
              placeholder="顧客に表示される説明文"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label="所要時間（分）"
              required
              value={form.duration_minutes ?? 60}
              onChange={(v) => set('duration_minutes', v)}
            />
            <NumField
              label="後バッファ（分）"
              value={form.buffer_after_minutes ?? 0}
              onChange={(v) => set('buffer_after_minutes', v)}
            />
            <NumField
              label="料金（円）"
              required
              value={form.base_price ?? 0}
              onChange={(v) => set('base_price', v)}
            />
            <NumField
              label="並び順"
              value={form.sort_order ?? 0}
              onChange={(v) => set('sort_order', v)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(form.is_active)}
              onChange={(e) => set('is_active', e.target.checked ? 1 : 0)}
              className="rounded"
            />
            有効（顧客に表示する）
          </label>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

function NumField({
  label,
  required,
  value,
  onChange,
}: { label: string; required?: boolean; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label} required={required}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 tabular-nums"
      />
    </Field>
  )
}
