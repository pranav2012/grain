import type { ReactNode } from 'react'
import { GrainGlyph, SlidersIcon } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { Progress } from '@/components/ui/Progress'
import { Segmented } from '@/components/ui/Segmented'
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
  problems: ReactNode
  onSwitch(): void
  onPalette(): void
  onSettings(): void
  onFinish(): void
}

export function TopBar({ data, mode, onMode, viewed, total, diffStyle, onDiffStyle, problems, onSwitch, onPalette, onSettings, onFinish }: TopBarProps) {
  return (
    <header className="flex items-center gap-4 border-b border-line bg-canvas px-3.5 [grid-area:top]">
      <div className="flex shrink-0 items-center gap-1.5 text-md font-semibold tracking-[-0.01em]">
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
        <Kbd className="opacity-0 group-hover:opacity-100">⌘O</Kbd>
      </button>
      <Segmented
        label="Review mode"
        size="sm"
        className="ml-auto"
        value={mode}
        onChange={onMode}
        options={modeOrder.map((m) => [m, modes[m].label])}
      />
      {problems}
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
      <div className="flex min-w-[130px] shrink-0 flex-col gap-1 text-xs text-fg-subtle max-[1100px]:hidden">
        <span>
          {viewed} of {total} files viewed
        </span>
        <Progress ok={viewed / Math.max(total, 1)} />
      </div>
      <Button onClick={onPalette}>
        Commands <Kbd>⌘K</Kbd>
      </Button>
      <Button onClick={onSettings} aria-label="Settings" title="Settings (,)" size="icon">
        <SlidersIcon />
      </Button>
      <Button variant="primary" onClick={onFinish}>
        {modes[mode].finish}
      </Button>
    </header>
  )
}
