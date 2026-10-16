import { useEffect, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Choice, ChoiceGroup } from '@/components/ui/Choice'
import { Dialog, DialogActions, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { usd } from '@/lib/format'
import { pickFolder } from '@/lib/pick-folder'
import type { Agent } from '@/types/generated/Agent'
import type { Settings } from '@/types/generated/Settings'
import type { UsageReport } from '@/types/generated/UsageReport'
import { settingsApi } from '../api'
import { ModelPicker } from './ModelPicker'

const agents: [Agent | null, string, string][] = [
  [null, 'No AI', 'Grain describes each block from the code and runs its own checks. Nothing is sent anywhere.'],
  ['claude', 'Claude Code', 'Uses the `claude` CLI you are signed in to.'],
  ['codex', 'Codex', 'Uses the `codex` CLI you are signed in to.'],
  ['opencode', 'OpenCode', 'Uses `opencode` with its configured model (not a Claude subscription).'],
]

export function SettingsDialog({ onClose, onSaved }: { onClose(): void; onSaved(s: Settings): void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [installed, setInstalled] = useState<Agent[]>([])
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    settingsApi.get().then(setS, (e: Error) => setError(e.message))
    settingsApi.me().then((m) => setInstalled(m.agentsInstalled), () => {})
    settingsApi.usage().then(setUsage, () => {})
  }, [])
  const addWorkFolder = () =>
    pickFolder('Choose a folder where you keep your code').then(
      (p) => p && setS((cur) => cur && (cur.workFolders.includes(p) ? cur : { ...cur, workFolders: [...cur.workFolders, p] })),
      (e: Error) => setError(e.message),
    )
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
    <Dialog label="Settings" onClose={onClose} className="flex h-[640px] flex-col overflow-hidden">
      <div className="px-5 pt-5">
        <DialogTitle>Settings</DialogTitle>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
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
                    onSelect={() => setS(s.agent === id ? s : { ...s, agent: id, reviewModel: null, summaryModel: null })}
                    label={label}
                    help={missing ? 'Not installed on this machine.' : help}
                  />
                )
              })}
            </ChoiceGroup>
            {s.agent && (
              <ModelPicker
                key={s.agent}
                agent={s.agent}
                reviewModel={s.reviewModel}
                summaryModel={s.summaryModel}
                onChange={(m) => setS({ ...s, ...m })}
              />
            )}
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
            <label className="mt-1.5 flex items-start gap-2.5 text-fg-subtle has-[:disabled]:opacity-50">
              <input
                type="checkbox"
                className="mt-1"
                checked={s.secondOpinion}
                disabled={!s.agent}
                onChange={(e) => setS({ ...s, secondOpinion: e.target.checked })}
              />
              <span>
                Give me a second opinion on every PR I open
                <small className="block text-sm text-fg-faint">
                  Your agent runs Grain's review skill read-only on the PR and its findings appear beside the code. Takes a few minutes and uses
                  your plan. Nothing is posted unless you keep it.
                </small>
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
            <SectionLabel className="mt-5">AI spend</SectionLabel>
            <p className="mt-1 text-sm text-fg-faint">
              What your agent's requests would cost at API prices. On a subscription this is usage, not a bill; Codex and OpenCode costs are estimated from
              token counts.
            </p>
            <label className="mt-2 flex items-center justify-between gap-3 text-fg-subtle">
              Daily budget (USD, 0 for none)
              <Input
                type="number"
                min={0}
                step={1}
                value={s.dailyBudgetUsd}
                onChange={(e) => setS({ ...s, dailyBudgetUsd: Math.max(0, Number(e.target.value) || 0) })}
                className="w-20"
              />
            </label>
            {usage && (
              <div className="mt-2 text-sm text-fg-subtle">
                <p>
                  Today {usd(usage.spend.today)}
                  {usage.spend.dailyBudget > 0 && ` of ${usd(usage.spend.dailyBudget)}`} · this month {usd(usage.spend.month)}
                  {usage.spend.estimated && ' (some estimated)'}
                </p>
                {usage.prs.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {usage.prs.slice(0, 6).map((p) => (
                      <li key={p.pr} className="flex justify-between gap-3 text-xs">
                        <span className="truncate font-mono text-fg-muted">{p.pr.startsWith('~local/') ? 'Local changes' : p.pr}</span>
                        <span className="shrink-0 text-fg-faint tabular-nums">
                          {usd(p.cost)} · {p.requests} {p.requests === 1 ? 'request' : 'requests'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <SectionLabel className="mt-5">Work folders</SectionLabel>
            <p className="mt-1 text-sm text-fg-faint">
              Where you keep your code, e.g. ~/work. When a repository opens for the first time, Grain looks here (and in common folders like ~/code) and
              uses your clone without asking.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {s.workFolders.map((w) => (
                <li key={w} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-1.5">
                  <span className="truncate font-mono text-xs text-fg">{w}</span>
                  <LinkButton onClick={() => setS({ ...s, workFolders: s.workFolders.filter((x) => x !== w) })}>Remove</LinkButton>
                </li>
              ))}
            </ul>
            <Button size="sm" className="mt-2" onClick={addWorkFolder}>
              Add folder…
            </Button>
          </>
        )}
      </div>
      {error && <p className="px-5 py-2 text-danger">{error}</p>}
      <DialogActions className="mt-0 border-t border-line px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!s}>
          Save settings
        </Button>
      </DialogActions>
    </Dialog>
  )
}
