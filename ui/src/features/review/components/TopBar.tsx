import { GrainGlyph, SlidersIcon } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { Progress } from '@/components/ui/Progress'
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
  const frac = (n: number) => n / Math.max(progress.reviewLines, 1)
  return (
    <header className="flex items-center gap-4 border-b border-line bg-canvas px-3.5 [grid-area:top]">
      <div className="flex items-center gap-1.5 text-md font-semibold tracking-[-0.01em]">
        <GrainGlyph /> grain
      </div>
      <button onClick={onSwitch} title="Open another pull request (⌘O)" className="group -ml-1.5 flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-fg-subtle hover:bg-surface">
        <strong title={data.pr?.title} className="max-w-[46ch] truncate font-medium text-fg">
          {data.pr?.title ?? data.id}
        </strong>
        {data.pr?.local ? (
          <span title={data.pr.local.path} className="whitespace-nowrap">
            {data.pr.local.path.split('/').pop()}
            {data.pr.local.base && ` vs ${data.pr.local.base}`}, including uncommitted files
          </span>
        ) : (
          data.pr && (
            <span className="whitespace-nowrap">
              {data.id.split('/').slice(0, 2).join('/')} #{data.pr.number}
            </span>
          )
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
      <div className="flex min-w-[150px] flex-col gap-1 text-xs text-fg-subtle">
        <span>
          {progress.done} of {progress.total} steps, {left > 0 ? `about ${formatMinutes(minutesFor(left))} left` : 'all read'}
        </span>
        <Progress ok={frac(progress.okLines)} change={frac(progress.changeLines)} />
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
