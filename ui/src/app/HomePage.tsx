import { GrainGlyph } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { PrPicker } from '@/features/pr-picker'

export function HomePage({ onOpen, onSettings }: { onOpen(id: string): void; onSettings(): void }) {
  return (
    <div className="flex min-h-screen flex-col items-center gap-[18px] pt-[9vh]">
      <header className="flex w-[min(760px,94vw)] items-center gap-3.5 text-fog">
        <div className="flex items-center gap-[7px] text-sm font-semibold tracking-[-0.01em] text-chalk">
          <GrainGlyph /> grain
        </div>
        <span>Pick a pull request to review, or paste any GitHub link.</span>
        <Button className="ml-auto" onClick={onSettings}>
          Settings
        </Button>
      </header>
      <PrPicker variant="page" onOpen={onOpen} />
    </div>
  )
}
