import { useEffect, useMemo, useRef, useState } from 'react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'
import { api } from './api'
import { SettingsDialog } from './components/SettingsDialog'
import { Switcher } from './components/Switcher'
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

function readRoute(): string | null {
  return new URLSearchParams(location.search).get('pr')
}

export default function App() {
  const [pr, setPr] = useState<string | null>(readRoute)
  const [switcher, setSwitcher] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  useEffect(() => {
    const onPop = () => setPr(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openPr = (id: string) => {
    setSwitcher(false)
    history.pushState(null, '', `?pr=${id}`)
    setPr(id)
  }
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {pr ? (
        <PrLoader key={pr} id={pr} settingsVersion={settingsVersion} onSwitch={() => setSwitcher(true)} onSettings={() => setSettings(true)} />
      ) : (
        <div className="home-wrap">
          <header className="home-head">
            <div className="wordmark">
              <GrainGlyph /> grain
            </div>
            <span>Pick a pull request to review, or paste any GitHub link.</span>
            <button className="btn" onClick={() => setSettings(true)}>
              Settings
            </button>
          </header>
          <Switcher asPage onOpen={openPr} />
        </div>
      )}
      {switcher && <Switcher onOpen={openPr} onClose={() => setSwitcher(false)} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={() => setSettingsVersion((v) => v + 1)} />}
    </WorkerPoolContextProvider>
  )
}

/** Asks the server to prepare the PR (cheap if unchanged), shows progress, then loads it. */
function PrLoader({ id, settingsVersion, onSwitch, onSettings }: { id: string; settingsVersion: number; onSwitch(): void; onSettings(): void }) {
  const [data, setData] = useState<LoadedPr | null>(null)
  const [message, setMessage] = useState('Opening the pull request')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const st = await api.status(id)
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
    api.open(id).then(poll, (e: Error) => setError(e.message))
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id])
  if (!data)
    return (
      <div className="loading">
        <GrainGlyph />
        <h1>{id.replace(/\/(\d+)$/, ' #$1')}</h1>
        {error ? (
          <>
            <p className="error-text">{error}</p>
            <button className="btn" onClick={onSwitch}>
              Open another pull request
            </button>
          </>
        ) : (
          <p>{message}…</p>
        )}
      </div>
    )
  return <Review base={data} settingsVersion={settingsVersion} onSwitch={onSwitch} onSettings={onSettings} />
}

function Review({ base, settingsVersion, onSwitch, onSettings }: { base: LoadedPr; settingsVersion: number; onSwitch(): void; onSettings(): void }) {
  const [summaries, setSummaries] = useState(base.summaries)
  const [agent, setAgent] = useState(base.pr?.agent ?? null)
  const [summaryNote, setSummaryNote] = useState<string | null>(null)
  const summariesRef = useRef(summaries)
  summariesRef.current = summaries
  const data = useMemo(() => ({ ...base, summaries, pr: base.pr && { ...base.pr, agent } }), [base, summaries, agent])

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

  const agentOn = !!data.pr?.agent
  useEffect(() => {
    if (!agentOn) return
    const i = order.indexOf(current)
    const keys = order
      .slice(i, i + 3)
      .map((id) => data.blocks.get(id)!)
      .filter((b) => !b.skim && !summaries[b.key])
      .map((b) => b.key)
    if (keys.length) api.summarize(data.name, keys).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, agentOn])
  useEffect(() => {
    const tick = async () => {
      const st = await api.status(data.name).catch(() => null)
      if (!st) return
      setAgent(st.agent)
      if (!st.agent) return setSummaryNote(null)
      const sm = st.summarizer
      setSummaryNote(sm?.stopped ?? (sm?.running ? 'Summarizing the next blocks' : null))
      const latest = await api.summaries(data.name).catch(() => null)
      if (latest && Object.keys(latest).length !== Object.keys(summariesRef.current).length) setSummaries(latest)
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [data.name, settingsVersion])

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
    o: onSwitch,
    ',': onSettings,
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault()
        keyActions.current.o()
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
      { id: 'switch', label: 'Open another pull request', hint: '⌘O', run: onSwitch },
      { id: 'settings', label: 'Settings: AI summaries', hint: ',', run: onSettings },
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
        <button className="pr-title" onClick={onSwitch} title="Open another pull request (⌘O)">
          {data.pr ? (
            <>
              <strong title={data.pr.title}>{data.pr.title}</strong>
              <span>
                {data.name.split('/').slice(0, 2).join('/')} #{data.pr.number}
              </span>
            </>
          ) : (
            <strong>{data.name}</strong>
          )}
          <kbd>⌘O</kbd>
        </button>
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
        <button className="btn icon" onClick={onSettings} aria-label="Settings" title="Settings (,)">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M2 4h8M13 4h1M2 12h2M7 12h7M10 2v4M4 10v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
          </svg>
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
          {copy.order}. {agentName ? summaryNote ?? `Summaries by ${agentName}.` : 'Working without AI.'} Progress is saved on this machine.
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
  ['⌘O', 'Open another pull request'],
  [',', 'Settings'],
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
