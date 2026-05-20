'use client'

import { useState } from 'react'
import { startUpdate } from '@/lib/update-client'
import { ProgressModal } from './progress-modal'

/**
 * Kicks off an update via `POST /admin/update/start` and mounts a
 * ProgressModal bound to the returned updateId. The modal manages its own
 * SSE/polling lifecycle and calls `onClose` when the operator dismisses it.
 */
export function UpdateButton({ targetVersion }: { targetVersion: string }) {
  const [loading, setLoading] = useState(false)
  const [updateId, setUpdateId] = useState<string | null>(null)

  async function onClick() {
    setLoading(true)
    try {
      const r = await startUpdate()
      setUpdateId(r.updateId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`update failed: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '開始中...' : `v${targetVersion} にアップデート`}
      </button>
      {updateId && (
        <ProgressModal
          updateId={updateId}
          onClose={() => setUpdateId(null)}
        />
      )}
    </>
  )
}
