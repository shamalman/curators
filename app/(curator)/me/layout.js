'use client'

import { usePathname } from 'next/navigation'
import MeSegmentedControl from '@/components/me/MeSegmentedControl'

export default function MeLayout({ children }) {
  const pathname = usePathname()
  const active = pathname === '/me'
    ? 'recs'
    : pathname.startsWith('/me/earnings')
      ? 'earnings'
      : 'taste'
  const needsInternalScroll = pathname === '/me'

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: 0,
      maxWidth: 700,
      margin: '0 auto',
      width: '100%',
      padding: '16px 20px 0',
    }}>
      <div style={{ flexShrink: 0 }}>
        <MeSegmentedControl active={active} />
      </div>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: needsInternalScroll ? 'hidden' : 'auto',
        minHeight: 0,
      }}>
        {children}
      </div>
    </div>
  )
}
