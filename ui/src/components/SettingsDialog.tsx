import { useEffect, useState } from 'react'
import { api, type Settings } from '../api'

const agents: [Settings['agent'], string, string][] = [
  [null, 'No AI', 'Grain describes each block from the code and runs its own checks. Nothing is sent anywhere.'],
  ['claude', 'Claude Code', 'Uses the `claude` CLI you are signed in to.'],
  ['codex', 'Codex', 'Uses the `codex` CLI you are signed in to.'],
  ['opencode', 'OpenCode', 'Uses `opencode` with its configured model (not a Claude subscription).'],
]

export function SettingsDialog({ onClose, onSaved }: { onClose(): void; onSaved(s: Settings): void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [installed, setInstalled] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.settings().then(setS, (e: Error) => setError(e.message))
    api.me().then((m) => setInstalled(m.agentsInstalled), () => {})
  }, [])
  const save = () =>
    s &&
    api.saveSettings(s).then(
      (saved) => {
        onSaved(saved)
        onClose()
      },
      (e: Error) => setError(e.message),
    )

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>Settings</h2>
        <p>AI summaries are optional. When on, Grain runs your own agent read-only, one block at a time, only near where you are reading, and caches every answer.</p>
        {s && (
          <>
            <div className="choices" role="radiogroup" aria-label="AI summaries">
              {agents.map(([id, label, help]) => {
                const missing = id !== null && !installed.includes(id)
                return (
                  <button key={label} className="choice" role="radio" aria-checked={s.agent === id} disabled={missing} onClick={() => setS({ ...s, agent: id })}>
                    <span>{s.agent === id ? '●' : '○'}</span>
                    <span>
                      {label}
                      <small>{missing ? 'Not installed on this machine.' : help}</small>
                    </span>
                  </button>
                )
              })}
            </div>
            <label className="field">
              Summaries per review, at most
              <input
                type="number"
                min={1}
                max={500}
                value={s.maxSummariesPerReview}
                onChange={(e) => setS({ ...s, maxSummariesPerReview: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          </>
        )}
        {error && <p style={{ color: 'var(--coral)' }}>{error}</p>}
        <div className="footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!s}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}
