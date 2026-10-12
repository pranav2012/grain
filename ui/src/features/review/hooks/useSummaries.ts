import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { Status } from '@/types/generated/Status'
import { reviewApi } from '../api'
import type { LoadedPr } from '../model/types'

/**
 * Agent summaries for an open review. Nothing is requested on open: the reviewer asks for a
 * block's summary, or turns on auto-summarize to get the current block and the next two.
 */
export function useSummaries(base: LoadedPr, status: Status | null, order: number[], current: number) {
  const [summaries, setSummaries] = useState(base.summaries)
  const [requested, setRequested] = useState<Set<string>>(new Set())
  const agent = status ? status.agent : (base.pr?.agent ?? null)
  const auto = status?.autoSummarize ?? false

  useEffect(() => {
    if (!agent || !status?.summarizer) return
    let alive = true
    reviewApi.summaries(base.id).then(
      (latest) => alive && setSummaries((prev) => (Object.keys(latest).length !== Object.keys(prev).length ? latest : prev)),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [agent, status, base.id])

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

  const note = !agent ? null : (status?.summarizer?.stopped ?? (status?.summarizer?.running ? 'Summarizing' : null))
  const data = useMemo(() => ({ ...base, summaries, pr: base.pr && { ...base.pr, agent } }), [base, summaries, agent])
  return { data, note, request, pending }
}
