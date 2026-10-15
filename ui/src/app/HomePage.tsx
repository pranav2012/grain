import { GrainGlyph } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { PrPicker } from '@/features/pr-picker'
import { WorkFolderNudge } from './WorkFolderNudge'

export function HomePage({ onOpen, onSettings, settingsVersion }: { onOpen(id: string): void; onSettings(): void; settingsVersion: number }) {
  return (
    <div className="flex min-h-dvh flex-col items-center gap-4.5 px-3 pt-[9vh] pb-6 max-sm:gap-3 max-sm:pt-4">
      <header className="flex w-full max-w-[760px] flex-wrap items-center gap-x-3.5 gap-y-1 text-fg-subtle">
        <div className="flex items-center gap-1.5 text-md font-semibold tracking-[-0.01em] text-fg">
          <GrainGlyph /> grain
        </div>
        <span className="max-sm:order-last max-sm:w-full">Pick a pull request, paste a GitHub link, or self-review your local changes.</span>
        <Button className="ml-auto" onClick={onSettings}>
          Settings
        </Button>
      </header>
      <WorkFolderNudge settingsVersion={settingsVersion} />
      <PrPicker variant="page" onOpen={onOpen} />
    </div>
  )
}
