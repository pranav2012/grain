import type { BlockState } from '../model/types'

export function StatusIcon({ state, current }: { state?: BlockState; current?: boolean }) {
  if (state === 'ok')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Reviewed">
        <circle cx="7" cy="7" r="6.5" fill="var(--color-sage)" />
        <path d="M4 7.2l2 2 4-4.2" stroke="var(--color-graphite)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (state === 'change')
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Change requested">
        <circle cx="7" cy="7" r="6.5" fill="var(--color-coral)" />
        <path d="M7 3.8v4M7 10v.2" stroke="var(--color-graphite)" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    )
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Not reviewed">
      <circle
        cx="7"
        cy="7"
        r="5.75"
        fill="none"
        stroke={current ? 'var(--color-periwinkle)' : 'var(--color-dim)'}
        strokeWidth="1.5"
        strokeDasharray={current ? '0' : '2 2.2'}
      />
    </svg>
  )
}

export function RiskDot({ risk }: { risk: string }) {
  const color = risk === 'high' ? 'bg-coral' : risk === 'medium' ? 'bg-amber' : null
  if (!color) return null
  return <span className={`inline-block size-1.5 rounded-full ${color}`} aria-label={`${risk} risk`} />
}
