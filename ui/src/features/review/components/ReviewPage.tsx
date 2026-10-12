import { useEffect, useState } from 'react'
import { GrainGlyph } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { formatPrRef } from '@/lib/pr-ref'
import { loadPr, reviewApi } from '../api'
import type { LoadedPr } from '../model/types'
import { ReviewScreen } from './ReviewScreen'

interface ReviewPageProps {
  /** `owner/repo/123` */
  id: string
  settingsVersion: number
  onSwitch(): void
  onSettings(): void
}

/** Asks the server to prepare the PR (cheap if unchanged), shows progress, then opens the review. */
export function ReviewPage({ id, settingsVersion, onSwitch, onSettings }: ReviewPageProps) {
  const [data, setData] = useState<LoadedPr | null>(null)
  const [message, setMessage] = useState('Opening the pull request')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const st = await reviewApi.status(id)
        if (!alive) return
        if (st.job.stage === 'preparing') {
          setMessage(st.job.message)
          timer = setTimeout(poll, 700)
        } else if (st.job.stage === 'failed') setError(st.job.message)
        else setData(await loadPr(id))
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    reviewApi.open(id).then(poll, (e: Error) => setError(e.message))
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id])

  if (data) return <ReviewScreen base={data} settingsVersion={settingsVersion} onSwitch={onSwitch} onSettings={onSettings} />
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2.5 text-fog">
      <GrainGlyph />
      <h1 className="mt-1 text-[17px] font-semibold text-chalk">{formatPrRef(id)}</h1>
      {error ? (
        <>
          <p className="max-w-[60ch] text-center text-coral">{error}</p>
          <Button onClick={onSwitch}>Open another pull request</Button>
        </>
      ) : (
        <p>{message}…</p>
      )}
    </div>
  )
}
