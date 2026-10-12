import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { Agent } from '@/types/generated/Agent'
import { reviewApi } from '../api'
import type { LoadedPr } from '../model/types'

/**
 * Agent summaries for an open review. Nothing is requested on open: the reviewer asks for a
 * block's summary, or turns on auto-summarize to get the current block and the next two.
 * Follows settings changes and reports why summaries stopped.
 */
export function useSummaries(base: LoadedPr, order: number[], current: number, settingsVersion: number) {
  const [summaries, setSummaries] = useState(base.summaries)
  const [agent, setAgent] = useState<Agent | null>(base.pr?.agent ?? null)
  const [auto, setAuto] = useState(false)
  const [requested, setRequested] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const tick = async () => {
      const st = await reviewApi.status(base.id).catch(() => null)
      if (!st) return
      setAgent(st.agent)
      setAuto(st.autoSummarize)
      if (!st.agent) return setNote(null)
      setNote(st.summarizer?.stopped ?? (st.summarizer?.running ? 'Summarizing the next blocks' : null))
      const latest = await reviewApi.summaries(base.id).catch(() => null)
      if (latest) setSummaries((prev) => (Object.keys(latest).length !== Object.keys(prev).length ? latest : prev))
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [base.id, settingsVersion])

  const send = (keys: string[]) => {
    const fresh = keys.filter((k) => !summaries[k])
    if (fresh.length) reviewApi.summarize(base.id, fresh).catch(() => {})
    return fresh
  }
  /** Reviewer asked for these blocks' summaries; they show as pending until they arrive. */
  const request = (keys: string[]) => {
    const fresh = send(keys.filter((k) => !requested.has(k)))
    if (fresh.length) setRequested((prev) => new Set([...prev, ...fresh]))
  }
  const pending = (key: string) => requested.has(key) && !summaries[key]

  const requestNearby = useEffectEvent(() => {
    const i = order.indexOf(current)
    const keys = order
      .slice(i, i + 3)
      .map((id) => base.blocks.get(id)!)
      .filter((b) => !b.skim && !summaries[b.key])
      .map((b) => b.key)
    send(keys)
  })
  useEffect(() => {
    if (agent && auto) requestNearby()
  }, [current, agent, auto])


  const data = useMemo(() => ({ ...base, summaries, pr: base.pr && { ...base.pr, agent } }), [base, summaries, agent])
  return { data, note, request, pending }
}
