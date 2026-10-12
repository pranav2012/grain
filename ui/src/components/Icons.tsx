export function GrainGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4c3-2 5 2 8 0s4-1 4-1M2 8c3-2 5 2 8 0s4-1 4-1M2 12c3-2 5 2 8 0s4-1 4-1"
        stroke="var(--color-sage)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M2 4h8M13 4h1M2 12h2M7 12h7M10 2v4M4 10v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
