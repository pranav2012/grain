import { useEffect, useMemo, useState } from 'react'
import { parsePatchFiles, type CodeViewItem } from '@pierre/diffs'
import { CodeView, WorkerPoolContextProvider, type CodeViewReactOptions } from '@pierre/diffs/react'
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import { Virtuoso } from 'react-virtuoso'

type Bench = { lib: string; pr: string; files: number; fetchMs: number; parseMs: number; firstPaintMs?: number; longTasksMs: number }
declare global {
  interface Window { __bench: Bench; __ready: boolean }
}

const params = new URLSearchParams(location.search)
const lib = params.get('lib') ?? 'pierre'
const pr = params.get('pr') ?? 'widgets-2671'
const t0 = performance.now()

window.__bench = { lib, pr, files: 0, fetchMs: 0, parseMs: 0, longTasksMs: 0 }
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) window.__bench.longTasksMs += Math.max(0, e.duration - 50)
}).observe({ type: 'longtask', buffered: true })

/** Marks first paint two frames after the view's first commit. */
function useFirstPaint(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.__bench.firstPaintMs = performance.now() - t0
        window.__ready = true
      }),
    )
  }, [enabled])
}

const workerFactory = () => new Worker(WorkerUrl, { type: 'module' })
const poolOptions = { workerFactory }
const highlighterOptions = { theme: { dark: 'pierre-dark', light: 'pierre-light' } } as const
const viewStyle = { height: '100vh', overflow: 'auto' } as const

function PierreView({ text }: { text: string }) {
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    const t = performance.now()
    const files = parsePatchFiles(text, pr).flatMap((p) => p.files)
    window.__bench.parseMs = performance.now() - t
    window.__bench.files = files.length
    return files.map((fileDiff, i) => ({ id: `d${i}`, type: 'diff', fileDiff }))
  }, [text])
  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({ diffStyle: 'unified', stickyHeaders: true, layout: { paddingTop: 8, paddingBottom: 8, gap: 8 } }),
    [],
  )
  useFirstPaint(true)
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      <CodeView items={items} style={viewStyle} options={options} />
    </WorkerPoolContextProvider>
  )
}

/** Splits a multi-file git patch into one chunk per file. */
function splitPatch(text: string) {
  return text
    .split(/^(?=diff --git )/m)
    .filter((c) => c.startsWith('diff --git '))
    .map((chunk) => {
      const m = /^diff --git a\/(.*?) b\/(.*)$/m.exec(chunk)
      return { oldName: m?.[1] ?? '', newName: m?.[2] ?? '', chunk }
    })
}

function GdvView({ text }: { text: string }) {
  const files = useMemo(() => {
    const t = performance.now()
    const f = splitPatch(text)
    window.__bench.parseMs = performance.now() - t
    window.__bench.files = f.length
    return f
  }, [text])
  useFirstPaint(true)
  return (
    <Virtuoso
      style={viewStyle}
      data={files}
      itemContent={(_, f) => (
        <div style={{ paddingBottom: 8 }}>
          <div style={{ font: '12px monospace', padding: 4, background: '#eee' }}>{f.newName}</div>
          <DiffView
            data={{ oldFile: { fileName: f.oldName }, newFile: { fileName: f.newName }, hunks: [f.chunk] }}
            diffViewMode={DiffModeEnum.Unified}
            diffViewHighlight
          />
        </div>
      )}
    />
  )
}

export default function App() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/patches/${pr}.patch`)
      .then((r) => r.text())
      .then((t) => {
        window.__bench.fetchMs = performance.now() - t0
        setText(t)
      })
  }, [])
  if (text === null) return <div>loading…</div>
  return lib === 'gdv' ? <GdvView text={text} /> : <PierreView text={text} />
}
