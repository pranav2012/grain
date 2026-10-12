import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { Agent } from '@/types/generated/Agent'
import { reviewApi } from '../api'
import type { LoadedPr } from '../model/types'

/**
 * Live agent summaries for an open review. Asks for the current block and the next two
 * (never the whole PR), follows settings changes, and reports why summaries stopped.
 */
export function useSummaries(base: LoadedPr, order: number[], current: number, settingsVersion: number) {
  const [summaries, setSummaries] = useState(base.summaries)
  const [agent, setAgent] = useState<Agent | null>(base.pr?.agent ?? null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const tick = async () => {
      const st = await reviewApi.status(base.id).catch(() => null)
      if (!st) return
      setAgent(st.agent)
      if (!st.agent) return setNote(null)
      setNote(st.summarizer?.stopped ?? (st.summarizer?.running ? 'Summarizing the next blocks' : null))
      const latest = await reviewApi.summaries(base.id).catch(() => null)
      if (latest) setSummaries((prev) => (Object.keys(latest).length !== Object.keys(prev).length ? latest : prev))
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [base.id, settingsVersion])

  const requestNearby = useEffectEvent(() => {
    const i = order.indexOf(current)
    const keys = order
      .slice(i, i + 3)
      .map((id) => base.blocks.get(id)!)
      .filter((b) => !b.skim && !summaries[b.key])
      .map((b) => b.key)
    if (keys.length) reviewApi.summarize(base.id, keys).catch(() => {})
  })
  useEffect(() => {
    if (agent) requestNearby()
  }, [current, agent])

  const data = useMemo(() => ({ ...base, summaries, pr: base.pr && { ...base.pr, agent } }), [base, summaries, agent])
  return { data, note }
}
