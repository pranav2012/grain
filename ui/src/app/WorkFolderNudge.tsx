import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { settingsApi } from '@/features/settings'
import { pickFolder } from '@/lib/pick-folder'
import type { Settings } from '@/types/generated/Settings'

/** Asks for a work folder until one is set: that's where Grain finds local clones for type errors, lint and faster setup. */
export function WorkFolderNudge({ settingsVersion }: { settingsVersion: number }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    settingsApi.get().then(setSettings, () => {})
  }, [settingsVersion])
  if (!settings || settings.workFolders.length > 0) return null

  const choose = () =>
    pickFolder('Choose the folder where you keep your code').then(
      (path) => {
        if (path) settingsApi.save({ ...settings, workFolders: [path] }).then(setSettings, (e: Error) => setError(e.message))
      },
      (e: Error) => setError(e.message),
    )
  return (
    <Card className="flex w-full max-w-[760px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-[min(100%,260px)] flex-1">
        <p className="font-medium text-fg">Add the folder where you keep your repos</p>
        <p className="text-sm text-fg-subtle">Grain finds your local clones there to show type errors and lint findings with each repo's own setup, and to open PRs faster.</p>
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      </div>
      <Button variant="primary" onClick={choose}>
        Choose folder
      </Button>
    </Card>
  )
}
