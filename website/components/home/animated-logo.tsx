// The grain mark, drawn in on load: the spine draws, then each line grows from the left.
export function AnimatedLogo({ size = 80 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      className="drop-shadow-[0_12px_32px_rgb(16_185_129/0.35)] transition-transform duration-500 hover:-rotate-3 hover:scale-105"
    >
      <rect width="64" height="64" rx="14" fill="#059669" />
      <g fill="#fff">
        <rect className="logo-bar" style={{ animationDelay: '0.25s' }} x="12" y="16" width="32" height="7" rx="3.5" />
        <rect className="logo-bar" style={{ animationDelay: '0.4s' }} x="24" y="29" width="28" height="7" rx="3.5" />
        <rect className="logo-bar" style={{ animationDelay: '0.55s' }} x="24" y="42" width="20" height="7" rx="3.5" opacity="0.55" />
      </g>
      <path
        className="logo-spine"
        d="M16 23V45.5H22M16 32.5H22"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
