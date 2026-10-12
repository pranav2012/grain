import { useEffect, useState } from 'react'
import type { Status } from '@/types/generated/Status'
import { reviewApi } from '../api'

/** Server status for an open review (agent, summarizer, background facts), refreshed every few seconds. */
export function useReviewStatus(id: string, settingsVersion: number) {
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => {
    let alive = true
    const tick = () =>
      reviewApi.status(id).then(
        (s) => alive && setStatus(s),
        () => {},
      )
    tick()
    const t = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id, settingsVersion])
  return status
}
