import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { isAdminOrOwner } from '../utils/roles'
import { isSystemAdmin } from '../utils/superAdmin'
import Modal from './Modal'

const MONTHLY_AED = 240

function isPenultimateOrLastDayOfMonth(date) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  const d = date.getDate()
  return d >= lastDay - 1
}

function currentAckMonthKey() {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${mo}`
}

/**
 * End-of-month reminder for tenant admins: cloud hosting maintenance (fixed AED amount).
 * Shown on the last two calendar days of each month until acknowledged (OK).
 */
export default function CloudHostingCostReminder() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  const storageKey = useCallback(() => {
    const uid = user?.id != null ? String(user.id) : 'user'
    return `hexabill.cloudCostAck.${uid}.${currentAckMonthKey()}`
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    if (!isAdminOrOwner(user)) return
    if (isSystemAdmin(user)) return
    if (!isPenultimateOrLastDayOfMonth(new Date())) return
    try {
      if (localStorage.getItem(storageKey()) === '1') return
    } catch {
      return
    }
    setOpen(true)
  }, [user, storageKey])

  const handleAck = () => {
    try {
      localStorage.setItem(storageKey(), '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  if (!open) return null

  return (
    <Modal
      isOpen={open}
      onClose={handleAck}
      title="Monthly cloud hosting reminder"
      size="md"
      closeOnOverlayClick={false}
    >
      <div className="space-y-4 text-primary-800 text-sm">
        <p>
          Please plan for HexaBill cloud hosting and infrastructure: <strong>{MONTHLY_AED} AED per month</strong>.
          This helps avoid service interruptions for your company and keeps backups and updates running.
        </p>
        <p className="text-primary-600">
          If you have already arranged payment for this month, tap OK to confirm you have seen this reminder.
        </p>
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleAck}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 min-h-[44px]"
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  )
}
