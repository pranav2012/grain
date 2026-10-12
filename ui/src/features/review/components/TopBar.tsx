import { GrainGlyph, SlidersIcon } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { Segmented } from '@/components/ui/Segmented'
import { formatMinutes, minutesFor } from '@/lib/format'
import { modeOrder, modes } from '../model/modes'
import type { LoadedPr, Mode } from '../model/types'

interface TopBarProps {
  data: LoadedPr
  mode: Mode
  onMode(mode: Mode): void
  progress: { done: number; total: number; okLines: number; changeLines: number; reviewLines: number }
  onSwitch(): void
  onPalette(): void
  onSettings(): void
  onFinish(): void
}

export function TopBar({ data, mode, onMode, progress, onSwitch, onPalette, onSettings, onFinish }: TopBarProps) {
  const left = progress.reviewLines - progress.okLines - progress.changeLines
  const pct = (n: number) => `${(100 * n) / Math.max(progress.reviewLines, 1)}%`
  return (
    <header className="flex items-center gap-4 border-b border-seam bg-graphite px-3.5 [grid-area:top]">
      <div className="flex items-center gap-[7px] text-sm font-semibold tracking-[-0.01em]">
        <GrainGlyph /> grain
      </div>
      <button onClick={onSwitch} title="Open another pull request (⌘O)" className="group -ml-1.5 flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-fog hover:bg-slate">
        <strong title={data.pr?.title} className="max-w-[46ch] truncate font-medium text-chalk">
          {data.pr?.title ?? data.id}
        </strong>
        {data.pr && (
          <span className="whitespace-nowrap">
            {data.id.split('/').slice(0, 2).join('/')} #{data.pr.number}
          </span>
        )}
        <Kbd className="opacity-0 group-hover:opacity-100">⌘O</Kbd>
      </button>
      <Segmented
        label="Review mode"
        className="ml-auto"
        value={mode}
        onChange={onMode}
        options={modeOrder.map((m) => [m, modes[m].label])}
      />
      <div className="flex min-w-[150px] flex-col gap-1 text-xs text-fog">
        <span>
          {progress.done} of {progress.total} blocks, {left > 0 ? `about ${formatMinutes(minutesFor(left))} left` : 'all read'}
        </span>
        <div className="flex h-[3px] overflow-hidden rounded-sm bg-seam" aria-hidden>
          <span className="h-full bg-sage" style={{ width: pct(progress.okLines) }} />
          <span className="h-full bg-coral" style={{ width: pct(progress.changeLines) }} />
        </div>
      </div>
      <Button onClick={onPalette}>
        Commands <Kbd>⌘K</Kbd>
      </Button>
      <Button onClick={onSettings} aria-label="Settings" title="Settings (,)" className="px-2 py-1.5">
        <SlidersIcon />
      </Button>
      <Button variant="primary" onClick={onFinish}>
        {modes[mode].finish}
      </Button>
    </header>
  )
}
