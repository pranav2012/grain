import type { BlockState } from '../types'

export function GrainGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4c3-2 5 2 8 0s4-1 4-1M2 8c3-2 5 2 8 0s4-1 4-1M2 12c3-2 5 2 8 0s4-1 4-1" stroke="#62b58c" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function StatusIcon({ state, current }: { state?: BlockState; current?: boolean }) {
  if (state === 'ok')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Reviewed">
        <circle cx="7" cy="7" r="6.5" fill="#62b58c" />
        <path d="M4 7.2l2 2 4-4.2" stroke="#16181d" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (state === 'change')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Change requested">
        <circle cx="7" cy="7" r="6.5" fill="#e46a5e" />
        <path d="M7 3.8v4M7 10v.2" stroke="#16181d" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Not reviewed">
      <circle cx="7" cy="7" r="5.75" fill="none" stroke={current ? '#8592f5' : '#5d636e'} strokeWidth="1.5" strokeDasharray={current ? '0' : '2 2.2'} />
    </svg>
  )
}

export function RiskDot({ risk }: { risk: string }) {
  const color = risk === 'high' ? '#e46a5e' : risk === 'medium' ? '#d8a443' : null
  if (!color) return null
  return <span style={{ width: 6, height: 6, borderRadius: 3, background: color, display: 'inline-block' }} aria-label={`${risk} risk`} />
}
