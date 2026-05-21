'use client'

import { useEffect, useState } from 'react'
import { T, F, S } from '@/lib/constants'
import EarningsHero from './EarningsHero'
import { formatDollar as fmtDollar } from '@/lib/format-money'

export default function EarningsView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [errorStatus, setErrorStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setErrorStatus(null)
      try {
        const res = await fetch('/api/earnings/preview', { credentials: 'include' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          if (!cancelled) {
            setErrorStatus(res.status)
            setError(body?.error || `http_${res.status}`)
            setLoading(false)
          }
          return
        }
        const json = await res.json()
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'fetch_failed')
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '24px 0', color: T.ink3, fontFamily: F, fontSize: 13 }}>
        Loading...
      </div>
    )
  }

  if (error) {
    const copy = errorStatus === 403
      ? 'Earnings is not available on this account.'
      : 'Could not load earnings.'
    return (
      <div style={{ padding: '24px 0', color: T.ink3, fontFamily: F, fontSize: 13 }}>
        {copy}
      </div>
    )
  }

  if (!data) return null

  return (
    <div style={{ paddingTop: 4 }}>
      <div style={{
        padding: '10px 14px',
        borderRadius: 10,
        border: `1.5px dashed ${T.bdr}`,
        background: T.s,
        color: T.ink2,
        fontFamily: F,
        fontSize: 12,
        lineHeight: 1.5,
        marginBottom: 20,
      }}>
        Projected (alpha). Real payouts begin when Curators exits alpha. These numbers reflect how the system would currently allocate.
      </div>

      <EarningsHero
        month={data.month}
        daysRemaining={data.days_remaining}
        totalEarnings={data.hero?.total_earnings}
        validations={data.hero?.validations}
        saves={data.hero?.saves}
        activeSubscribers={data.hero?.active_subscribers}
      />

      <SectionHeader label="TOP RECOMMENDATIONS THIS MONTH" />
      {(!data.top_recs || data.top_recs.length === 0) ? (
        <EmptyState text="No earnings yet this month." />
      ) : (
        <div style={{ marginBottom: 24 }}>
          {data.top_recs.map(rec => (
            <RecRow key={rec.rec_id} rec={rec} />
          ))}
        </div>
      )}

      <SectionHeader label="FROM YOUR SUBSCRIBERS" />
      {(!data.contributing_subscribers || data.contributing_subscribers.length === 0) ? (
        <EmptyState text="No subscribers contributing yet this month." />
      ) : (
        <div style={{ marginBottom: 24 }}>
          {data.contributing_subscribers.map(row => (
            <SubscriberRow key={row.subscriber_id} row={row} />
          ))}
        </div>
      )}

      <div style={{ height: 40 }} />
    </div>
  )
}

function SectionHeader({ label }) {
  return (
    <div style={{
      borderTop: `1px solid ${T.bdr}`,
      paddingTop: 12,
      marginBottom: 4,
    }}>
      <span style={{
        fontFamily: F,
        fontSize: 10,
        letterSpacing: '0.08em',
        color: T.ink3,
        textTransform: 'uppercase',
        fontWeight: 600,
      }}>
        {label}
      </span>
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div style={{
      padding: '12px 0',
      marginBottom: 24,
      color: T.ink3,
      fontFamily: F,
      fontSize: 13,
    }}>
      {text}
    </div>
  )
}

function RecRow({ rec }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 0',
      borderBottom: `1px solid ${T.bdr}`,
    }}>
      <div style={{
        flex: 1,
        minWidth: 0,
        fontFamily: F,
        fontSize: 13,
        color: T.ink,
        fontWeight: 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {rec.title || '(untitled)'}
      </div>
      <span style={{
        fontFamily: S,
        fontSize: 16,
        color: T.acc,
        fontWeight: 400,
        flexShrink: 0,
      }}>
        {fmtDollar(rec.amount)}
      </span>
    </div>
  )
}

function SubscriberRow({ row }) {
  const signals = []
  if (row.validations > 0) signals.push(`${row.validations} cosign${row.validations === 1 ? '' : 's'}`)
  if (row.saves > 0) signals.push(`${row.saves} save${row.saves === 1 ? '' : 's'}`)
  const summary = signals.length > 0 ? signals.join(' · ') : 'subscribed'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 0',
      borderBottom: `1px solid ${T.bdr}`,
    }}>
      <InitialBubble handle={row.handle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: F,
          fontSize: 13,
          color: T.ink,
          fontWeight: 500,
        }}>
          @{row.handle}
        </div>
        <div style={{
          fontFamily: F,
          fontSize: 11,
          color: T.ink3,
          marginTop: 2,
        }}>
          {summary}
        </div>
      </div>
      <span style={{
        fontFamily: S,
        fontSize: 16,
        color: T.acc,
        fontWeight: 400,
        flexShrink: 0,
      }}>
        {fmtDollar(row.amount)}
      </span>
    </div>
  )
}

function InitialBubble({ handle }) {
  const initial = (handle || '?').charAt(0).toUpperCase()
  return (
    <div style={{
      width: 32,
      height: 32,
      borderRadius: 16,
      background: T.s2,
      color: T.ink2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: F,
      fontSize: 13,
      fontWeight: 600,
      flexShrink: 0,
    }}>
      {initial}
    </div>
  )
}
