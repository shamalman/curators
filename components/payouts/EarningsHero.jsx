'use client'

import { T, F, S } from '@/lib/constants'
import { formatDollar as fmtDollar } from '@/lib/format-money'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatMonthLabel(monthKey) {
  // monthKey is "YYYY-MM". Returns "Month YYYY, in progress".
  if (!monthKey || typeof monthKey !== 'string') return 'This month, in progress'
  const [yearStr, monthStr] = monthKey.split('-')
  const monthIdx = parseInt(monthStr, 10) - 1
  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return 'This month, in progress'
  return `${MONTH_NAMES[monthIdx]} ${yearStr}, in progress`
}

export default function EarningsHero({ month, daysRemaining, totalEarnings, validations, saves, activeSubscribers }) {
  const subscriberCount = activeSubscribers || 0
  const subLine = `across ${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'} · ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontFamily: F,
        fontSize: 11,
        color: T.ink3,
        marginBottom: 6,
      }}>
        {formatMonthLabel(month)}
      </div>

      <div style={{
        fontFamily: S,
        fontSize: 44,
        color: T.ink,
        fontWeight: 400,
        lineHeight: 1.1,
      }}>
        {fmtDollar(totalEarnings)}
      </div>

      <div style={{
        fontFamily: F,
        fontSize: 11,
        color: T.ink3,
        marginTop: 6,
        marginBottom: 20,
      }}>
        {subLine}
      </div>

      <div style={{
        display: 'flex',
        gap: 24,
        padding: '14px 16px',
        background: T.s,
        borderRadius: 10,
        border: `1px solid ${T.bdr}`,
      }}>
        <Stat label="Cosigns" value={validations || 0} />
        <Stat label="Saves" value={saves || 0} />
        <Stat label="Active subs" value={activeSubscribers || 0} />
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
    }}>
      <div style={{
        fontFamily: S,
        fontSize: 22,
        color: T.ink,
        fontWeight: 400,
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: F,
        fontSize: 11,
        color: T.ink3,
        marginTop: 4,
        letterSpacing: '0.02em',
      }}>
        {label}
      </div>
    </div>
  )
}
