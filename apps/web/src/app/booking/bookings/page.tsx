'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { bookingApi, type BookingRequest } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '未承認' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'expired', label: '期限切れ' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'all', label: '全件' },
]

const statusBadgeColor: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  expired: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-600',
  completed: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

const statusLabel: Record<string, string> = {
  requested: 'リクエスト',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '無断',
}

const actionLabel: Record<string, string> = {
  approve: '承認',
  reject: '拒否',
  cancel: 'キャンセル',
  no_show: '無断キャンセル',
  complete: '完了',
}

function formatJpDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export default function BookingsPage() {
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<string>('requested')
  const [items, setItems] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // タブ/アカウント切り替えで先に list をクリア。fetch 失敗時に前タブの行が
    // 残ってしまい、誤って別ステータスの予約を操作してしまう事故を防ぐ。
    setItems([])
    try {
      const r = await bookingApi.listRequests(selectedAccountId, tab)
      setItems(r.requests)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, tab])

  useEffect(() => {
    load()
  }, [load])

  async function handleDecide(id: string, action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') {
    if (!selectedAccountId) return
    if (!confirm(`この予約を「${actionLabel[action]}」しますか？`)) return
    try {
      await bookingApi.decideRequest(selectedAccountId, id, action)
      await load()
    } catch (e) {
      alert(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div>
      <Header
        title="予約管理"
        description="顧客からの予約リクエストを承認・拒否します"
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              tab === key ? 'text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={tab === key ? { backgroundColor: '#06C755' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

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
          該当する予約はありません
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日時</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">顧客</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">メニュー</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">担当</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">要望</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">料金</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">状態</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{formatJpDateTime(b.starts_at)}</td>
                    <td className="px-4 py-3 text-sm">{b.friend_name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm">{b.menu_name}</td>
                    <td className="px-4 py-3 text-sm">{b.staff_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={b.customer_note ?? ''}>
                      {b.customer_note ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">¥{b.price_at_booking.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusBadgeColor[b.status] ?? 'bg-gray-100'}`}>
                        {statusLabel[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionButtons status={b.status} onAction={(a) => handleDecide(b.id, a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionButtons({
  status,
  onAction,
}: {
  status: string
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  if (status === 'requested') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('approve')}
          className="px-3 py-1 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#06C755' }}
        >
          承認
        </button>
        <button
          onClick={() => onAction('reject')}
          className="px-3 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
        >
          拒否
        </button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('complete')}
          className="px-3 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
        >
          完了
        </button>
        <button
          onClick={() => onAction('no_show')}
          className="px-3 py-1 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md"
        >
          無断
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md"
        >
          取消
        </button>
      </div>
    )
  }
  return <span className="text-xs text-gray-400">-</span>
}
