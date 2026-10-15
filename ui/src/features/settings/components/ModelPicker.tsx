import { useEffect, useState } from 'react'
import { usd } from '@/lib/format'
import type { Agent } from '@/types/generated/Agent'
import type { ModelOption } from '@/types/generated/ModelOption'
import type { ModelsResponse } from '@/types/generated/ModelsResponse'
import { settingsApi } from '../api'

const agentNames: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }

const describe = (m: ModelOption) =>
  [m.name, m.releaseDate?.slice(0, 7), m.outputPrice != null && `${usd(m.outputPrice)}/M out`].filter(Boolean).join(' · ')

interface ModelPickerProps {
  agent: Agent
  reviewModel: string | null
  summaryModel: string | null
  onChange(models: { reviewModel: string | null; summaryModel: string | null }): void
}

/** The agent's models, listed live: one for reviews and questions, one for summaries; empty means Automatic. */
export function ModelPicker({ agent, reviewModel, summaryModel, onChange }: ModelPickerProps) {
  const [data, setData] = useState<ModelsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    settingsApi.models(agent).then(
      (d) => alive && setData(d),
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [agent])
  const name = agentNames[agent]
  const select = 'w-full rounded-lg border border-line-strong bg-canvas px-2.5 py-1.5 text-sm text-fg'
  const options = (data?.models ?? []).map((m) => (
    <option key={m.id} value={m.id}>
      {describe(m)}
    </option>
  ))
  const keep = (value: string | null) => value && !data?.models.some((m) => m.id === value) && <option value={value}>{value}</option>
  const auto = data?.summaryAuto
  return (
    <div className="mt-2 flex flex-col gap-2.5 text-sm text-fg-subtle">
      <label className="flex flex-col gap-1">
        Model for second opinions and questions
        <select className={select} value={reviewModel ?? ''} onChange={(e) => onChange({ reviewModel: e.target.value || null, summaryModel })}>
          <option value="">Automatic: {name}'s own default, kept current by its maker</option>
          {keep(reviewModel)}
          {options}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Model for summaries and chapter intros
        <select className={select} value={summaryModel ?? ''} onChange={(e) => onChange({ reviewModel, summaryModel: e.target.value || null })}>
          <option value="">Automatic: {auto ? `${auto.name} (newest of the cheapest), low effort` : `${name}'s default, low effort`}</option>
          {keep(summaryModel)}
          {options}
        </select>
      </label>
      <p className="text-xs text-fg-faint">
        {!data && !error && `Asking ${name} which models it offers…`}
        {error}
        {data &&
          (data.catalog
            ? `${data.models.length} models from ${agent === 'claude' ? 'Anthropic, via the models.dev catalog' : name}. Release dates and prices come from models.dev; new models show up by themselves.`
            : "Couldn't reach models.dev, so dates and prices are missing and Automatic uses the agent's default.")}
      </p>
    </div>
  )
}
