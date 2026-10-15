import { useEffect, useState } from 'react'
import { GrainGlyph } from '@/components/Icons'
import { Button } from '@/components/ui/Button'
import { formatPrRef } from '@/lib/pr-ref'
import { loadPr, reviewApi } from '../api'
import type { LoadedPr } from '../model/types'
import { RepoSetup } from './RepoSetup'
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
  const [needsRepo, setNeedsRepo] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [refresh, setRefresh] = useState(false)
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
        } else if (st.job.stage === 'needsRepo') setNeedsRepo(true)
        else if (st.job.stage === 'failed') setError(st.job.message)
        else setData(await loadPr(id))
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    reviewApi.open(id, refresh).then(poll, (e: Error) => setError(e.message))
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, attempt, refresh])

  const reload = () => {
    setData(null)
    setMessage('Checking for changes')
    setRefresh(true)
    setAttempt((a) => a + 1)
  }

  if (data)
    return <ReviewScreen base={data} settingsVersion={settingsVersion} onSwitch={onSwitch} onSettings={onSettings} onReload={reload} />
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2.5 px-4 text-center text-fg-subtle">
      <GrainGlyph />
      <h1 className="mt-1 text-lg font-semibold break-all text-fg">{formatPrRef(id)}</h1>
      {needsRepo ? (
        <RepoSetup
          fullRepo={id.split('/').slice(0, 2).join('/')}
          onDone={() => {
            setNeedsRepo(false)
            setAttempt((a) => a + 1)
          }}
        />
      ) : error ? (
        <>
          <p className="max-w-[60ch] text-center text-danger">{error}</p>
          <Button onClick={onSwitch}>Open another pull request</Button>
        </>
      ) : (
        <p>{message}…</p>
      )}
    </div>
  )
}
