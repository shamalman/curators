import { F } from '@/lib/constants'

export default function PublicLayout({ children }) {
  return <div data-public-route style={{ minHeight: '100vh', fontFamily: F }}>{children}</div>
}
