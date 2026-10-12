import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Choice, ChoiceGroup } from '@/components/ui/Choice'
import { Dialog, DialogActions, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import type { Agent } from '@/types/generated/Agent'
import type { Settings } from '@/types/generated/Settings'
import { settingsApi } from '../api'

const agents: [Agent | null, string, string][] = [
  [null, 'No AI', 'Grain describes each block from the code and runs its own checks. Nothing is sent anywhere.'],
  ['claude', 'Claude Code', 'Uses the `claude` CLI you are signed in to.'],
  ['codex', 'Codex', 'Uses the `codex` CLI you are signed in to.'],
  ['opencode', 'OpenCode', 'Uses `opencode` with its configured model (not a Claude subscription).'],
]

export function SettingsDialog({ onClose, onSaved }: { onClose(): void; onSaved(s: Settings): void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [installed, setInstalled] = useState<Agent[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    settingsApi.get().then(setS, (e: Error) => setError(e.message))
    settingsApi.me().then((m) => setInstalled(m.agentsInstalled), () => {})
  }, [])
  const save = () =>
    s &&
    settingsApi.save(s).then(
      (saved) => {
        onSaved(saved)
        onClose()
      },
      (e: Error) => setError(e.message),
    )

  return (
    <Dialog label="Settings" onClose={onClose} className="p-5">
      <DialogTitle>Settings</DialogTitle>
      <p className="mb-3.5 leading-relaxed text-fg-subtle">
        AI is off unless you turn it on. With an agent chosen, Grain only summarizes a block when you ask (press a), runs your own agent read-only, and caches every answer.
      </p>
      {s && (
        <>
          <ChoiceGroup label="AI summaries" className="my-3">
            {agents.map(([id, label, help]) => {
              const missing = id !== null && !installed.includes(id)
              return (
                <Choice
                  key={label}
                  checked={s.agent === id}
                  disabled={missing}
                  onSelect={() => setS({ ...s, agent: id })}
                  label={label}
                  help={missing ? 'Not installed on this machine.' : help}
                />
              )
            })}
          </ChoiceGroup>
          <label className="mt-1.5 flex items-start gap-2.5 text-fg-subtle has-[:disabled]:opacity-50">
            <input
              type="checkbox"
              className="mt-1"
              checked={s.autoSummarize}
              disabled={!s.agent}
              onChange={(e) => setS({ ...s, autoSummarize: e.target.checked })}
            />
            <span>
              Also summarize the next blocks automatically while I read
              <small className="block text-sm text-fg-faint">Never runs when a pull request first opens. Off by default.</small>
            </span>
          </label>
          <label className="mt-3 flex items-start gap-2.5 text-fg-subtle">
            <input type="checkbox" className="mt-1" checked={s.prefetch} onChange={(e) => setS({ ...s, prefetch: e.target.checked })} />
            <span>
              Get my newest review requests ready in the background
              <small className="block text-sm text-fg-faint">Up to 5 at a time, so they open instantly. Git and grouping only, never AI.</small>
            </span>
          </label>
          <label className="mt-3 flex items-center justify-between gap-3 text-fg-subtle">
            Summaries per review, at most
            <Input
              type="number"
              min={1}
              max={500}
              value={s.maxSummariesPerReview}
              onChange={(e) => setS({ ...s, maxSummariesPerReview: Math.max(1, Number(e.target.value) || 1) })}
              className="w-20"
            />
          </label>
        </>
      )}
      {error && <p className="mt-3 text-danger">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!s}>
          Save settings
        </Button>
      </DialogActions>
    </Dialog>
  )
}
