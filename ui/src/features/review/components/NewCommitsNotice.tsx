import { Button } from '@/components/ui/Button'

/** Shown when the PR got new commits after this review was opened. */
export function NewCommitsNotice({ onReload }: { onReload(): void }) {
  return (
    <div
      role="status"
      className="fixed right-4 bottom-12 z-10 flex items-center gap-3 rounded-lg border border-seam bg-slate px-3.5 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] motion-safe:animate-rise"
    >
      <span>New commits were pushed to this pull request.</span>
      <Button variant="primary" onClick={onReload}>
        Load them
      </Button>
    </div>
  )
}
