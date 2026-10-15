import type { ReactNode } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
// Vite resolves `?worker&url` to the bundled worker's URL; the linter can't see virtual modules.
// oxlint-disable-next-line import/default
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'

const poolOptions = { workerFactory: () => new Worker(WorkerUrl, { type: 'module' }) }
// Names are wrapped in their own elements so ⌘-click (go to definition) can find them; the shared
// worker pool takes this once, so per-diff options can't turn it on.
const highlighterOptions = { theme: { dark: 'pierre-dark', light: 'pierre-light' }, useTokenTransformer: true } as const

/** App-wide providers: syntax highlighting runs in a worker pool shared by every diff. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  )
}
