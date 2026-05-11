'use client'

import { useRouter } from 'next/navigation'
import { useCurator } from '@/context/CuratorContext'
import { hasFeature } from '@/lib/features'
import SegmentedControl from '@/components/ui/SegmentedControl'

export default function MeSegmentedControl({ active }) {
  const router = useRouter()
  const { profile } = useCurator()

  const handle = profile?.handle?.replace('@', '') || ''
  const showEarnings = profile?.isTester === true && hasFeature(profile, 'payout_earnings_ui')

  const onChange = (id) => {
    if (id === 'recs') router.push('/me')
    else if (id === 'taste') router.push('/me/taste')
    else if (id === 'earnings') router.push('/me/earnings')
    else if (id === 'profile' && handle) router.push('/' + handle)
  }

  const options = [
    { id: 'recs', label: 'My Recs' },
    { id: 'taste', label: 'Record' },
    ...(showEarnings ? [{ id: 'earnings', label: 'Earnings' }] : []),
    { id: 'profile', label: 'Public Profile' },
  ]

  return (
    <SegmentedControl
      options={options}
      active={active}
      onChange={onChange}
      style={{ marginBottom: 24 }}
    />
  )
}
