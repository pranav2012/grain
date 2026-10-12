import { useEffect, useState } from 'react'
import type { Status } from '@/types/generated/Status'
import { reviewApi, withReview } from '../api'
import type { LoadedPr } from '../model/types'

/**
 * The review as shown: starts from the fast first pass and swaps in the complete one when
 * the server finishes adding whole-repo facts. Blocks and ids are identical in both.
 */
export function useLiveReview(base: LoadedPr, status: Status | null): LoadedPr {
  const [live, setLive] = useState(base)
  const waiting = !live.review.complete
  const doneOnServer = status !== null && !status.enriching && status.job.stage === 'ready'
  useEffect(() => {
    if (!waiting || !doneOnServer) return
    let alive = true
    reviewApi.review(base.id).then(
      (review) => alive && review.complete && setLive((prev) => withReview(prev, review)),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [waiting, doneOnServer, status, base.id])
  return live
}
