'use client'

import { useRouter } from 'next/navigation'
import { useCurator } from '@/context/CuratorContext'
import SegmentedControl from '@/components/ui/SegmentedControl'

export default function MeSegmentedControl({ active }) {
  const router = useRouter()
  const { profile } = useCurator()

  const handle = profile?.handle?.replace('@', '') || ''

  const onChange = (id) => {
    if (id === 'recs') router.push('/me')
    else if (id === 'taste') router.push('/me/taste')
    else if (id === 'profile' && handle) router.push('/' + handle)
  }

  return (
    <SegmentedControl
      options={[
        { id: 'recs', label: 'My Recs' },
        { id: 'taste', label: 'Record' },
        { id: 'profile', label: 'Public Profile' },
      ]}
      active={active}
      onChange={onChange}
      style={{ marginBottom: 24 }}
    />
  )
}
