import { GrainGlyph } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { PrPicker } from '@/features/pr-picker'
import { WorkFolderNudge } from './WorkFolderNudge'

export function HomePage({ onOpen, onSettings, settingsVersion }: { onOpen(id: string): void; onSettings(): void; settingsVersion: number }) {
  return (
    <div className="flex min-h-screen flex-col items-center gap-4.5 pt-[9vh]">
      <header className="flex w-[min(760px,94vw)] items-center gap-3.5 text-fg-subtle">
        <div className="flex items-center gap-1.5 text-md font-semibold tracking-[-0.01em] text-fg">
          <GrainGlyph /> grain
        </div>
        <span>Pick a pull request, paste a GitHub link, or self-review your local changes.</span>
        <Button className="ml-auto" onClick={onSettings}>
          Settings
        </Button>
      </header>
      <WorkFolderNudge settingsVersion={settingsVersion} />
      <PrPicker variant="page" onOpen={onOpen} />
    </div>
  )
}
