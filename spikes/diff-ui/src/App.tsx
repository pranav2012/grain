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

type Block = { id: number; lines: number; files: string[]; entities: string[]; kind: string; has_tests: boolean; mechanical_entities: number }
type Summary = { title?: string; intent?: string; risk?: string; risk_reasons?: string[]; reviewer_questions?: string[] }

const riskColor: Record<string, string> = { high: '#d1242f', medium: '#bf8700', low: '#1a7f37' }

/** Block-by-block review preview: sidebar of grouped blocks, diff of the selected block only. */
function BlocksView({ text, blocks, summaries }: { text: string; blocks: Block[]; summaries: Record<string, Summary> }) {
  const [sel, setSel] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const allFiles = useMemo(() => parsePatchFiles(text, pr).flatMap((p) => p.files), [text])
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    const want = new Set(blocks[sel]?.files ?? [])
    return allFiles.filter((f) => want.has(f.name) || (f.prevName && want.has(f.prevName))).map((fileDiff, i) => ({ id: `b${sel}-${i}`, type: 'diff', fileDiff }))
  }, [allFiles, blocks, sel])
  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(() => ({ diffStyle: 'unified', stickyHeaders: true, layout: { paddingTop: 8, paddingBottom: 8, gap: 8 } }), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'j') setSel((s) => Math.min(blocks.length - 1, s + 1))
      if (e.key === 'k') setSel((s) => Math.max(0, s - 1))
      if (e.key === ' ') {
        e.preventDefault()
        setDone((d) => new Set(d).add(sel))
        setSel((s) => Math.min(blocks.length - 1, s + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocks.length, sel])
  const b = blocks[sel]
  const s = summaries[String(b?.id)]
  const label = (x: Block) => summaries[String(x.id)]?.title ?? x.files.map((f) => f.split('/').pop()).slice(0, 2).join(', ') + (x.files.length > 2 ? ` +${x.files.length - 2}` : '')
  return (
    <div style={{ display: 'flex', height: '100vh', font: '13px system-ui' }}>
      <aside style={{ width: 300, overflow: 'auto', borderRight: '1px solid #ddd', background: '#fafafa' }}>
        <div style={{ padding: 12, fontWeight: 600 }}>
          {done.size}/{blocks.length} blocks reviewed
          <div style={{ fontWeight: 400, color: '#666', marginTop: 4 }}>j / k to move · space = reviewed → next</div>
        </div>
        {blocks.map((x, i) => (
          <div key={x.id} onClick={() => setSel(i)} style={{ padding: '8px 12px', cursor: 'pointer', background: i === sel ? '#e7f0ff' : undefined, borderLeft: `3px solid ${riskColor[summaries[String(x.id)]?.risk ?? ''] ?? 'transparent'}` }}>
            <div>{done.has(i) ? '✅ ' : ''}{label(x)}</div>
            <div style={{ color: '#888', fontSize: 11 }}>{x.lines} lines · {x.files.length} files · {x.kind}{x.has_tests ? ' · tests' : ''}</div>
          </div>
        ))}
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {b && (
          <header style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Block {b.id}: {s?.title ?? label(b)} {s?.risk && <span style={{ color: riskColor[s.risk], fontSize: 12 }}>● {s.risk} risk</span>}
            </div>
            {s?.intent && <div style={{ marginTop: 4 }}>🤖 {s.intent}</div>}
            {s?.reviewer_questions && (
              <details style={{ marginTop: 4 }}>
                <summary>Questions to ask ({s.reviewer_questions.length})</summary>
                <ul>{s.reviewer_questions.map((q) => <li key={q}>{q}</li>)}</ul>
              </details>
            )}
            {!s && <div style={{ color: '#666', marginTop: 4 }}>Why grouped: {b.entities.slice(0, 3).map((e) => e.replace(/ \(.*\)$/, '')).join('; ')}{b.entities.length > 3 ? ` +${b.entities.length - 3} more` : ''}</div>}
          </header>
        )}
        <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
          <CodeView key={sel} items={items} style={{ flex: 1, overflow: 'auto' }} options={options} />
        </WorkerPoolContextProvider>
      </main>
    </div>
  )
}

export default function App() {
  const [text, setText] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  useEffect(() => {
    fetch(`/patches/${pr}.patch`)
      .then((r) => r.text())
      .then((t) => {
        window.__bench.fetchMs = performance.now() - t0
        setText(t)
      })
    if (lib === 'blocks') {
      fetch(`/patches/${pr}.blocks.json`).then((r) => r.json()).then(setBlocks)
      fetch(`/patches/${pr}.summaries.json`).then((r) => (r.ok ? r.json() : {})).then(setSummaries).catch(() => {})
    }
  }, [])
  if (text === null || (lib === 'blocks' && blocks === null)) return <div>loading…</div>
  if (lib === 'blocks') return <BlocksView text={text} blocks={blocks!} summaries={summaries} />
  return lib === 'gdv' ? <GdvView text={text} /> : <PierreView text={text} />
}
