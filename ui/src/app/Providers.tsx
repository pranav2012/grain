import type { ReactNode } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
// Vite resolves `?worker&url` to the bundled worker's URL; the linter can't see virtual modules.
// oxlint-disable-next-line import/default
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'

const poolOptions = { workerFactory: () => new Worker(WorkerUrl, { type: 'module' }) }
const highlighterOptions = { theme: { dark: 'pierre-dark', light: 'pierre-light' } } as const

/** App-wide providers: syntax highlighting runs in a worker pool shared by every diff. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  )
}
