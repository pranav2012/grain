import { useEffect, useState } from 'react'
import type { AiReview } from '@/types/generated/AiReview'
import type { Diagnostics } from '@/types/generated/Diagnostics'
import type { OutsideUsesFile } from '@/types/generated/OutsideUsesFile'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { Status } from '@/types/generated/Status'
import { reviewApi } from '../api'

const pending = (s: PrStatus | null) => s?.state === 'OPEN' && s.checks.some((c) => c.status !== 'completed')

/** When the shown PR status was fetched (Unix seconds), and whether a fresh one is on its way. */
export interface Freshness {
  at: number | null
  checking: boolean
}

/**
 * Errors from the reviewer's own tools and the agent's second opinion (each refetched when its run
 * finishes), and the PR's GitHub status: the saved copy at once, then a fresh one, refreshed every
 * minute while CI is still running.
 */
export function useChecks(id: string, local: boolean, status: Status | null) {
  const [report, setReport] = useState<Diagnostics | null>(null)
  const [prStatus, setPrStatus] = useState<PrStatus | null>(null)
  const [freshness, setFreshness] = useState<Freshness>({ at: null, checking: false })
  const diagnosing = status?.diagnosing ?? true
  const head = status?.headSha
  const [version, setVersion] = useState(0)
  const [ai, setAi] = useState<AiReview | null>(null)
  const reviewing = status?.reviewing ?? true

  useEffect(() => {
    if (reviewing) return
    let alive = true
    reviewApi.aiReview(id).then(
      (r) => alive && setAi(r),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [id, reviewing, head, version])

  const [uses, setUses] = useState<OutsideUsesFile | null>(null)
  useEffect(() => {
    if (diagnosing) return
    let alive = true
    reviewApi.diagnostics(id).then(
      (r) => alive && setReport(r),
      () => {},
    )
    reviewApi.outsideUsesFile(id).then(
      (u) => alive && setUses(u),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [id, diagnosing, head, version])

  useEffect(() => {
    if (local || !head) return
    let alive = true
    let live = false
    let timer: ReturnType<typeof setTimeout>
    const show = (s: PrStatus) => setPrStatus((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s))
    reviewApi.savedPrStatus(id).then(
      (saved) => {
        if (!alive || live || saved?.head !== head) return
        show(saved.status)
        setFreshness((f) => ({ ...f, at: saved.fetchedAt }))
      },
      () => {},
    )
    const load = () => {
      setFreshness((f) => ({ ...f, checking: true }))
      reviewApi.prStatus(id).then(
        (s) => {
          if (!alive) return
          live = true
          show(s)
          setFreshness({ at: Math.floor(Date.now() / 1000), checking: false })
          if (pending(s)) timer = setTimeout(load, 60_000)
        },
        () => alive && setFreshness((f) => ({ ...f, checking: false })),
      )
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, local, head])

  const rerun = () => {
    setReport(null)
    reviewApi.rediagnose(id).then(() => setTimeout(() => setVersion((v) => v + 1), 1500), () => {})
  }
  const rereview = () => {
    setAi(null)
    reviewApi.rereview(id).then(() => setTimeout(() => setVersion((v) => v + 1), 1500), () => {})
  }
  return { report, prStatus, freshness, diagnosing: !!status?.diagnosing, rerun, ai, reviewing: !!status?.reviewing, rereview, uses }
}
