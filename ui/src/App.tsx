import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'
import { agentName as agentNameOf, blockTitle, formatMinutes, loadPr, minutesFor, sectionsFor, type LoadedPr } from './data'
import { modes } from './modes'
import { usePrefs, useReviewState } from './store'
import type { CommentKind, Mode, ReviewComment } from './types'
import { BlockView } from './components/BlockView'
import { CommandPalette, type Command } from './components/CommandPalette'
import { ContextPanel } from './components/ContextPanel'
import { FinishDialog } from './components/FinishDialog'
import { GrainMap } from './components/GrainMap'
import { GrainGlyph } from './components/Icons'
import { Outline } from './components/Outline'

const poolOptions = { workerFactory: () => new Worker(WorkerUrl, { type: 'module' }) }
const highlighterOptions = { theme: { dark: 'pierre-dark', light: 'pierre-light' } } as const
const prName = new URLSearchParams(location.search).get('pr') ?? ''

export default function App() {
  const [data, setData] = useState<LoadedPr | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!prName) return setError('Open a PR with ?pr=<name>, or run spikes/try.sh <owner/repo> <number>.')
    loadPr(prName).then(setData, (e: Error) => setError(e.message))
  }, [])
  if (error) return <div className="empty" style={{ marginTop: '30vh' }}>{error}</div>
  if (!data) return <div className="empty" style={{ marginTop: '30vh' }}>Grouping the pull request…</div>
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      <Review data={data} />
    </WorkerPoolContextProvider>
  )
}

function Review({ data }: { data: LoadedPr }) {
  const viewer = data.pr?.viewer
  const [prefs, setPrefs] = usePrefs()
  const toggleDiffStyle = () => setPrefs((p) => ({ ...p, diffStyle: p.diffStyle === 'split' ? 'unified' : 'split' }))
  const defaultMode: Mode = viewer && viewer === data.pr?.author.login ? 'self' : 'peer'
  const [state, dispatch] = useReviewState(data.name, defaultMode)
  const [palette, setPalette] = useState(false)
  const [finish, setFinish] = useState(false)
  const [help, setHelp] = useState(false)
  const [showContext, setShowContext] = useState(true)
  const [composing, setComposing] = useState<CommentKind | null>(null)
  const copy = modes[state.mode]

  const sections = useMemo(() => sectionsFor(data, state.mode), [data, state.mode])
  const order = useMemo(() => sections.flatMap((s) => s.blocks), [sections])
  const reviewable = useMemo(() => order.filter((id) => !data.blocks.get(id)!.skim), [order, data])
  const current = state.current && data.blocks.has(state.current) ? state.current : order[0]
  const block = data.blocks.get(current)!
  const section = sections.find((s) => s.blocks.includes(current))!
  const blockComments = state.comments.filter((c) => c.blockId === current)

  const go = (id: number | undefined) => id !== undefined && dispatch({ type: 'go', id })
  const step = (d: number) => go(order[Math.min(order.length - 1, Math.max(0, order.indexOf(current) + d))])
  const stepChapter = (d: number) => {
    const i = sections.indexOf(section) + d
    if (sections[i]) go(sections[i].blocks[0])
  }
  const nextUnreviewed = () => order.slice(order.indexOf(current) + 1).find((id) => !state.states[id]) ?? order.find((id) => !state.states[id])
  const primary = () => {
    dispatch({ type: 'mark', id: current, state: state.states[current] === 'ok' ? null : 'ok' })
    if (state.states[current] !== 'ok') go(nextUnreviewed())
  }
  const secondary = () => {
    dispatch({ type: 'mark', id: current, state: 'change' })
    setShowContext(true)
    setComposing(copy.secondaryKind)
  }
  const addComment = (c: Omit<ReviewComment, 'id' | 'createdAt' | 'blockId'>) =>
    dispatch({ type: 'comment', comment: { ...c, blockId: current, id: crypto.randomUUID(), createdAt: Date.now() } })
  const setMode = (mode: Mode) => dispatch({ type: 'mode', mode })

  const keyActions = useRef<Record<string, () => void>>({})
  keyActions.current = {
    j: () => step(1),
    k: () => step(-1),
    J: () => stepChapter(1),
    K: () => stepChapter(-1),
    ' ': primary,
    x: secondary,
    c: () => {
      setShowContext(true)
      setComposing(copy.kinds[0][0])
    },
    '1': () => setMode('self'),
    '2': () => setMode('peer'),
    '3': () => setMode('maintainer'),
    ']': () => setShowContext((v) => !v),
    s: toggleDiffStyle,
    '?': () => setHelp((v) => !v),
    Enter: () => setFinish(true),
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter' && !e.shiftKey) return
      const action = keyActions.current[e.key === 'Enter' ? 'Enter' : e.key]
      if (action) {
        e.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doneLines = reviewable.filter((id) => state.states[id] === 'ok').reduce((n, id) => n + data.blocks.get(id)!.lines, 0)
  const changeLines = reviewable.filter((id) => state.states[id] === 'change').reduce((n, id) => n + data.blocks.get(id)!.lines, 0)
  const reviewLines = reviewable.reduce((n, id) => n + data.blocks.get(id)!.lines, 0)
  const doneCount = reviewable.filter((id) => state.states[id]).length
  const leftLines = reviewLines - doneLines - changeLines
  const pct = (n: number) => `${(100 * n) / Math.max(reviewLines, 1)}%`

  const commands: Command[] = useMemo(
    () => [
      { id: 'finish', label: copy.finish, hint: 'Shift Enter', run: () => setFinish(true) },
      ...(['self', 'peer', 'maintainer'] as Mode[]).map((m, i) => ({ id: `mode-${m}`, label: `Switch to ${modes[m].label.toLowerCase()}`, hint: String(i + 1), run: () => setMode(m) })),
      { id: 'next-open', label: 'Go to next unreviewed block', run: () => go(nextUnreviewed()) },
      { id: 'diff-style', label: prefs.diffStyle === 'split' ? 'Show unified diff' : 'Show side-by-side diff', hint: 's', run: toggleDiffStyle },
      { id: 'context', label: showContext ? 'Hide context panel' : 'Show context panel', hint: ']', run: () => setShowContext((v) => !v) },
      ...order.map((id) => ({
        id: `b${id}`,
        label: blockTitle(data, data.blocks.get(id)!),
        hint: sections.find((s) => s.blocks.includes(id))?.title,
        run: () => go(id),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, sections, state.mode, showContext, state.states, prefs.diffStyle],
  )

  const chapterIndex = section.blocks.indexOf(current) + 1
  const agentName = agentNameOf(data)

  return (
    <div className={`app ${showContext ? '' : 'no-context'}`}>
      <header className="top">
        <div className="wordmark">
          <GrainGlyph /> grain
        </div>
        <div className="pr-title">
          {data.pr ? (
            <>
              <strong title={data.pr.title}>{data.pr.title}</strong>
              <span>
                #{data.pr.number} into {data.pr.baseRefName}
              </span>
            </>
          ) : (
            <strong>{data.name}</strong>
          )}
        </div>
        <div className="modes" role="group" aria-label="Review mode">
          {(['self', 'peer', 'maintainer'] as Mode[]).map((m) => (
            <button key={m} aria-pressed={state.mode === m} onClick={() => setMode(m)} title={`${modes[m].order} (${['self', 'peer', 'maintainer'].indexOf(m) + 1})`}>
              {modes[m].label}
            </button>
          ))}
        </div>
        <div className="progress">
          <span>
            {doneCount} of {reviewable.length} blocks, {leftLines > 0 ? `about ${formatMinutes(minutesFor(leftLines))} left` : 'all read'}
          </span>
          <div className="progress-bar" aria-hidden>
            <span style={{ width: pct(doneLines), background: 'var(--sage)' }} />
            <span style={{ width: pct(changeLines), background: 'var(--coral)' }} />
          </div>
        </div>
        <button className="btn" onClick={() => setPalette(true)}>
          Commands <kbd>⌘K</kbd>
        </button>
        <button className="btn primary" onClick={() => setFinish(true)}>
          {copy.finish}
        </button>
      </header>

      <GrainMap data={data} sections={sections} states={state.states} current={current} onGo={go} />
      <Outline data={data} sections={sections} states={state.states} current={current} onGo={go} />
      <BlockView
        data={data}
        block={block}
        mode={state.mode}
        chapterTitle={section.title}
        position={`Block ${chapterIndex} of ${section.blocks.length}`}
        diffStyle={prefs.diffStyle}
        onDiffStyle={(diffStyle) => setPrefs((p) => ({ ...p, diffStyle }))}
        state={state.states[current]}
        comments={blockComments}
        onPrimary={primary}
        onSecondary={secondary}
        onComment={addComment}
        onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
      />
      {showContext ? (
        <ContextPanel
          data={data}
          block={block}
          mode={state.mode}
          comments={blockComments}
          composing={composing}
          agentName={agentName}
          onCompose={setComposing}
          onComment={addComment}
          onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
        />
      ) : (
        <div />
      )}

      <footer className="keys">
        <span>
          <kbd>j</kbd>
          <kbd>k</kbd> Move
        </span>
        <span>
          <kbd>space</kbd> {copy.primary}
        </span>
        <span>
          <kbd>x</kbd> {copy.secondary}
        </span>
        <span>
          <kbd>c</kbd> Note
        </span>
        <span>
          <kbd>⌘K</kbd> Commands
        </span>
        <span>
          <kbd>?</kbd> All shortcuts
        </span>
        <span>
          <kbd>s</kbd> {prefs.diffStyle === 'split' ? 'Unified' : 'Side by side'}
        </span>
        <span className="note">
          {copy.order}. {agentName ? `Summaries by ${agentName}.` : 'Working without AI.'} Progress is saved on this machine.
        </span>
      </footer>

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {finish && <FinishDialog data={data} mode={state.mode} states={state.states} comments={state.comments} reviewable={reviewable} onClose={() => setFinish(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  )
}

const shortcuts: [string, string][] = [
  ['j / k', 'Next or previous block'],
  ['Shift J / K', 'Next or previous chapter'],
  ['space', 'Primary action for the mode, then jump to the next open block'],
  ['x', 'Request a change or ask the agent to fix'],
  ['c', 'Note on the whole block'],
  ['Line numbers', 'Click or drag to comment on lines'],
  ['1 / 2 / 3', 'Self review, peer review, maintainer'],
  ['s', 'Switch between unified and side-by-side diff'],
  [']', 'Show or hide the context panel'],
  ['⌘K', 'Jump anywhere or run a command'],
  ['Shift Enter', 'Finish the review'],
]

function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 18px', marginTop: 14 }}>
          {shortcuts.map(([k, d]) => (
            <div key={k} style={{ display: 'contents' }}>
              <kbd style={{ justifySelf: 'start' }}>{k}</kbd>
              <span style={{ color: 'var(--fog)' }}>{d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
