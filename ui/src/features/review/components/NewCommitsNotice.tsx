import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

/** Shown when the PR got new commits, or local files changed, after this review was opened. */
export function NewCommitsNotice({ local, onReload }: { local: boolean; onReload(): void }) {
  return (
    <Card float role="status" className="fixed right-4 bottom-12 z-10 flex items-center gap-3 px-3.5 py-2.5 motion-safe:animate-rise">
      <span>{local ? 'Your files changed since this review was prepared.' : 'New commits were pushed to this pull request.'}</span>
      <Button variant="primary" onClick={onReload}>
        {local ? 'Refresh' : 'Load them'}
      </Button>
    </Card>
  )
}
