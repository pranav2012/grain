import { useEffect, useState } from 'react'
import type { AiReview } from '@/types/generated/AiReview'
import type { Diagnostics } from '@/types/generated/Diagnostics'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { Status } from '@/types/generated/Status'
import { reviewApi } from '../api'

const pending = (s: PrStatus | null) => s?.state === 'OPEN' && s.checks.some((c) => c.status !== 'completed')

/**
 * Errors from the reviewer's own tools and the agent's second opinion (each refetched when its run
 * finishes), and the PR's GitHub status, refreshed every minute while CI is still running.
 */
export function useChecks(id: string, local: boolean, status: Status | null) {
  const [report, setReport] = useState<Diagnostics | null>(null)
  const [prStatus, setPrStatus] = useState<PrStatus | null>(null)
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

  useEffect(() => {
    if (diagnosing) return
    let alive = true
    reviewApi.diagnostics(id).then(
      (r) => alive && setReport(r),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [id, diagnosing, head, version])

  useEffect(() => {
    if (local) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = () =>
      reviewApi.prStatus(id).then(
        (s) => {
          if (!alive) return
          setPrStatus(s)
          if (pending(s)) timer = setTimeout(load, 60_000)
        },
        () => {},
      )
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
  return { report, prStatus, diagnosing: !!status?.diagnosing, rerun, ai, reviewing: !!status?.reviewing, rereview }
}
