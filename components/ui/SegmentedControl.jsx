'use client'

import { T, F } from '@/lib/constants'

export default function SegmentedControl({ options, active, onChange, style }) {
  const btnStyle = (isActive) => ({
    flex: 1,
    textAlign: 'center',
    background: isActive ? T.s : 'transparent',
    color: isActive ? T.ink : T.ink3,
    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
    borderRadius: 8,
    padding: '8px 4px',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: F,
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  })

  return (
    <div style={{
      display: 'flex',
      background: T.bg2,
      borderRadius: 10,
      padding: 3,
      border: `1px solid ${T.s}`,
      ...style,
    }}>
      {options.map(opt => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          style={btnStyle(active === opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
