import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
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
      <h2 className="mb-1 text-[17px] font-semibold">Settings</h2>
      <p className="mb-3.5 leading-relaxed text-fog">
        AI summaries are optional. When on, Grain runs your own agent read-only, one block at a time, only near where you are reading, and caches every answer.
      </p>
      {s && (
        <>
          <div role="radiogroup" aria-label="AI summaries" className="my-3 flex flex-col gap-1.5">
            {agents.map(([id, label, help]) => {
              const missing = id !== null && !installed.includes(id)
              return (
                <button
                  key={label}
                  role="radio"
                  aria-checked={s.agent === id}
                  disabled={missing}
                  onClick={() => setS({ ...s, agent: id })}
                  className="grid grid-cols-[18px_1fr] gap-2.5 rounded-lg border border-seam px-3 py-2.5 text-left aria-checked:border-fog aria-checked:bg-slate-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{s.agent === id ? '●' : '○'}</span>
                  <span>
                    {label}
                    <small className="mt-0.5 block text-fog">{missing ? 'Not installed on this machine.' : help}</small>
                  </span>
                </button>
              )
            })}
          </div>
          <label className="mt-1.5 flex items-center justify-between gap-3 text-fog">
            Summaries per review, at most
            <input
              type="number"
              min={1}
              max={500}
              value={s.maxSummariesPerReview}
              onChange={(e) => setS({ ...s, maxSummariesPerReview: Math.max(1, Number(e.target.value) || 1) })}
              className="w-20 rounded-md border border-seam bg-graphite px-2 py-1 text-chalk"
            />
          </label>
        </>
      )}
      {error && <p className="mt-3 text-coral">{error}</p>}
      <div className="mt-3.5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!s}>
          Save settings
        </Button>
      </div>
    </Dialog>
  )
}
