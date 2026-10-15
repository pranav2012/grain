import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GrainGlyph, SlidersIcon } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { Progress } from '@/components/ui/Progress'
import { Segmented } from '@/components/ui/Segmented'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { modeOrder, modes } from '../model/modes'
import type { DiffStyle, LoadedPr, Mode } from '../model/types'

interface TopBarProps {
  data: LoadedPr
  mode: Mode
  onMode(mode: Mode): void
  viewed: number
  total: number
  diffStyle: DiffStyle
  onDiffStyle(style: DiffStyle): void
  canSplit: boolean
  problems: ReactNode
  comments: ReactNode
  /** Opens the file outline when it isn't shown as a column. */
  onOutline?(): void
  onSwitch(): void
  onPalette(): void
  onSettings(): void
  onFinish(): void
}

export function TopBar({ data, mode, onMode, viewed, total, diffStyle, onDiffStyle, canSplit, problems, comments, onOutline, onSwitch, onPalette, onSettings, onFinish }: TopBarProps) {
  const compact = useMediaQuery('(max-width: 1279px)')
  const phone = useMediaQuery('(max-width: 639px)')
  const modeSwitch = <Segmented label="Review mode" size="sm" value={mode} onChange={onMode} options={modeOrder.map((m) => [m, modes[m].label])} />
  const diffSwitch = canSplit && (
    <Segmented
      label="Diff layout (s)"
      size="sm"
      value={diffStyle}
      onChange={onDiffStyle}
      options={[
        ['unified', 'Unified'],
        ['split', 'Split'],
      ]}
    />
  )
  return (
    <header className="flex min-w-0 items-center gap-4 border-b border-line bg-canvas px-3.5 [grid-area:top] max-lg:gap-2 max-sm:px-2">
      {onOutline && (
        <Button variant="ghost" size="icon" aria-label="Files" title="Files in reading order" onClick={onOutline}>
          <span aria-hidden className="block w-4 text-center leading-none">☰</span>
        </Button>
      )}
      <div className="flex shrink-0 items-center gap-1.5 text-md font-semibold tracking-[-0.01em] max-sm:hidden">
        <GrainGlyph /> grain
      </div>
      <button onClick={onSwitch} title="Open another pull request (⌘O)" className="group -ml-1.5 flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-fg-subtle hover:bg-surface">
        <strong title={data.pr?.title} className="max-w-[46ch] min-w-0 truncate font-medium text-fg">
          {data.pr?.title ?? data.id}
        </strong>
        {data.pr?.local ? (
          <span title={data.pr.local.path} className="min-w-0 truncate max-[1200px]:hidden">
            {data.pr.local.path.split('/').pop()}
            {data.pr.local.base && ` vs ${data.pr.local.base}`}, including uncommitted files
          </span>
        ) : (
          data.pr && (
            <span className="shrink-0 whitespace-nowrap max-[1200px]:hidden">
              {data.id.split('/').slice(0, 2).join('/')} #{data.pr.number}
            </span>
          )
        )}
        <Kbd className="opacity-0 group-hover:opacity-100 max-lg:hidden">⌘O</Kbd>
      </button>
      {!compact && <span className="ml-auto">{modeSwitch}</span>}
      {!phone && problems}
      {comments}
      {!compact && diffSwitch}
      <div className="flex min-w-[130px] shrink-0 flex-col gap-1 text-xs text-fg-subtle max-[1100px]:hidden">
        <span>
          {viewed} of {total} files viewed
        </span>
        <Progress ok={viewed / Math.max(total, 1)} />
      </div>
      {compact ? (
        <MoreMenu>
          {phone && <div className="flex flex-wrap items-center gap-2 empty:hidden">{problems}</div>}
          <SectionLabel>Review mode</SectionLabel>
          {modeSwitch}
          {diffSwitch && (
            <>
              <SectionLabel>Diff layout</SectionLabel>
              {diffSwitch}
            </>
          )}
          <p className="text-xs text-fg-subtle">
            {viewed} of {total} files viewed
          </p>
          <div className="flex gap-2">
            <Button className="flex-1 justify-center" onClick={onPalette}>
              Commands
            </Button>
            <Button className="flex-1 justify-center" onClick={onSettings}>
              <SlidersIcon /> Settings
            </Button>
          </div>
        </MoreMenu>
      ) : (
        <>
          <Button onClick={onPalette}>
            Commands <Kbd>⌘K</Kbd>
          </Button>
          <Button onClick={onSettings} aria-label="Settings" title="Settings (,)" size="icon">
            <SlidersIcon />
          </Button>
        </>
      )}
      <Button variant="primary" onClick={onFinish} className="max-sm:px-2.5">
        {modes[mode].finish}
      </Button>
    </header>
  )
}

/** The top bar's overflow on narrow screens: a popover under a ⋯ button. */
function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0">
      <Button size="icon" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="block w-4 text-center leading-none">⋯</span>
      </Button>
      {open && (
        <div
          onClick={(e) => (e.target as HTMLElement).closest('button') && setOpen(false)}
          className="absolute top-full right-0 z-40 mt-1.5 flex w-[320px] flex-col max-sm:fixed max-sm:inset-x-2 max-sm:top-12 max-sm:w-auto gap-2 rounded-lg border border-line bg-surface p-3 shadow-overlay motion-safe:animate-rise"
        >
          {children}
        </div>
      )}
    </div>
  )
}
