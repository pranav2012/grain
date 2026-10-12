import { useMemo, useState } from 'react'
import { CommandPalette, type Command } from '@/components/CommandPalette'
import { useHotkeys } from '@/lib/useHotkeys'
import { ThreadActionsContext, useConversation } from '../hooks/useConversation'
import { useLiveReview } from '../hooks/useLiveReview'
import { useReviewStatus } from '../hooks/useReviewStatus'
import { useSummaries } from '../hooks/useSummaries'
import { agentName as agentNameOf, blockTitle } from '../model/describe'
import { modeOrder, modes } from '../model/modes'
import { blockProgress } from '../model/progress'
import { sectionsFor } from '../model/sections'
import type { CommentKind, LoadedPr, Mode, ReviewComment } from '../model/types'
import { usePrefs } from '../state/usePrefs'
import { useReviewState } from '../state/useReviewState'
import { BlockView } from './BlockView'
import { ContextPanel } from './ContextPanel'
import { FinishDialog } from './FinishDialog'
import { GrainMap } from './GrainMap'
import { KeyHints } from './KeyHints'
import { NewCommitsNotice } from './NewCommitsNotice'
import { Outline } from './Outline'
import { ShortcutsDialog } from './ShortcutsDialog'
import { TopBar } from './TopBar'

type NewComment = Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>

function newComment(c: NewComment, blockId: number, blockKey: string): ReviewComment {
  return { ...c, blockId, blockKey, id: crypto.randomUUID(), createdAt: Date.now() }
}

interface ReviewScreenProps {
  base: LoadedPr
  settingsVersion: number
  onSwitch(): void
  onSettings(): void
  /** Re-prepares the review with the latest commits or local edits. */
  onReload(): void
}

export function ReviewScreen({ base, settingsVersion, onSwitch, onSettings, onReload }: ReviewScreenProps) {
  const viewer = base.pr?.viewer
  const [state, dispatch] = useReviewState(base, viewer && viewer === base.pr?.author.login ? 'self' : 'peer')
  const [prefs, setPrefs] = usePrefs()
  const [overlay, setOverlay] = useState<'palette' | 'finish' | 'help' | null>(null)
  const [showContext, setShowContext] = useState(true)
  const [composing, setComposing] = useState<CommentKind | null>(null)
  const copy = modes[state.mode]

  const status = useReviewStatus(base.id, settingsVersion)
  const live = useLiveReview(base, status)
  const baseSections = useMemo(() => sectionsFor(live, state.mode), [live, state.mode])
  const baseOrder = useMemo(() => baseSections.flatMap((s) => s.blocks), [baseSections])
  const keyToId = useMemo(() => new Map([...live.blocks.values()].map((b) => [b.key, b.id])), [live])
  const current = (state.currentKey && keyToId.get(state.currentKey)) || baseOrder[0]
  const { data, note, request: requestSummary, pending: summaryPending } = useSummaries(live, status, baseOrder, current)

  const { threadsFor, actions: threadActions } = useConversation(data)
  const sections = useMemo(() => sectionsFor(data, state.mode), [data, state.mode])
  const order = useMemo(() => sections.flatMap((s) => s.blocks), [sections])
  const reviewable = useMemo(() => order.filter((id) => !data.blocks.get(id)!.skim), [order, data])
  const block = data.blocks.get(current)!
  const section = sections.find((s) => s.blocks.includes(current))!
  const { states, stale } = useMemo(() => blockProgress(data, state.verdicts), [data, state.verdicts])
  const blockComments = state.comments.filter((c) => c.blockKey === block.key)

  const go = (id: number | undefined) => {
    const b = id === undefined ? undefined : data.blocks.get(id)
    if (b) dispatch({ type: 'go', key: b.key })
  }
  const step = (d: number) => go(order[Math.min(order.length - 1, Math.max(0, order.indexOf(current) + d))])
  const stepChapter = (d: number) => go(sections[sections.indexOf(section) + d]?.blocks[0])
  const nextOpen = () => order.slice(order.indexOf(current) + 1).find((id) => !states[id]) ?? order.find((id) => !states[id])
  const verdict = (state: 'ok' | 'change') => ({ state, hash: block.contentHash, head: data.pr?.headSha ?? '', files: block.files })
  const setMode = (mode: Mode) => dispatch({ type: 'mode', mode })
  const toggleDiffStyle = () => setPrefs((p) => ({ ...p, diffStyle: p.diffStyle === 'split' ? 'unified' : 'split' }))
  const compose = (kind: CommentKind) => {
    setShowContext(true)
    setComposing(kind)
  }
  const primary = () => {
    const done = states[current] === 'ok'
    dispatch({ type: 'mark', key: block.key, verdict: done ? null : verdict('ok') })
    if (!done) go(nextOpen())
  }
  const secondary = () => {
    dispatch({ type: 'mark', key: block.key, verdict: verdict('change') })
    compose(copy.secondaryKind)
  }
  const addComment = (c: NewComment) => dispatch({ type: 'comment', comment: newComment(c, current, block.key) })

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    J: () => stepChapter(1),
    K: () => stepChapter(-1),
    ' ': primary,
    x: secondary,
    c: () => compose(copy.kinds[0][0]),
    s: toggleDiffStyle,
    a: () => {
      if (agentName) summarizeCurrent()
      else onSettings()
    },
    '1': () => setMode('self'),
    '2': () => setMode('peer'),
    '3': () => setMode('maintainer'),
    ']': () => setShowContext((v) => !v),
    '?': () => setOverlay((o) => (o === 'help' ? null : 'help')),
    ',': onSettings,
    o: onSwitch,
    'Mod+o': onSwitch,
    'Mod+k': () => setOverlay((o) => (o === 'palette' ? null : 'palette')),
    'Shift+Enter': () => setOverlay('finish'),
  })

  const lines = (ids: number[]) => ids.reduce((n, id) => n + data.blocks.get(id)!.lines, 0)
  const progress = {
    done: reviewable.filter((id) => states[id]).length,
    total: reviewable.length,
    okLines: lines(reviewable.filter((id) => states[id] === 'ok')),
    changeLines: lines(reviewable.filter((id) => states[id] === 'change')),
    reviewLines: lines(reviewable),
  }
  const agentName = agentNameOf(data)
  const summarizeCurrent = () => agentName && !block.skim && requestSummary([block.key])
  const commands: Command[] = [
    { id: 'finish', label: copy.finish, hint: 'Shift Enter', run: () => setOverlay('finish') },
    { id: 'switch', label: 'Open another pull request', hint: '⌘O', run: onSwitch },
    { id: 'settings', label: 'Settings: AI summaries', hint: ',', run: onSettings },
    ...modeOrder.map((m, i) => ({ id: `mode-${m}`, label: `Switch to ${modes[m].label.toLowerCase()}`, hint: String(i + 1), run: () => setMode(m) })),
    { id: 'next-open', label: 'Go to next unreviewed block', run: () => go(nextOpen()) },
    ...(agentName ? [{ id: 'summarize', label: `Summarize this block with ${agentName}`, hint: 'a', run: summarizeCurrent }] : []),
    { id: 'diff-style', label: prefs.diffStyle === 'split' ? 'Show unified diff' : 'Show side-by-side diff', hint: 's', run: toggleDiffStyle },
    { id: 'context', label: showContext ? 'Hide context panel' : 'Show context panel', hint: ']', run: () => setShowContext((v) => !v) },
    ...order.map((id) => ({ id: `b${id}`, label: blockTitle(data, data.blocks.get(id)!), hint: sections.find((s) => s.blocks.includes(id))?.title, run: () => go(id) })),
  ]

  return (
    <ThreadActionsContext value={threadActions}>
      <div
        className={`grid h-screen grid-rows-[48px_1fr_30px] [grid-template-areas:'top_top_top_top'_'map_outline_main_context'_'keys_keys_keys_keys'] max-[1100px]:grid-cols-[34px_240px_minmax(0,1fr)_0] max-[760px]:grid-cols-[0_0_minmax(0,1fr)_0] ${
          showContext ? 'grid-cols-[34px_288px_minmax(0,1fr)_320px]' : 'grid-cols-[34px_288px_minmax(0,1fr)_0]'
        }`}
      >
        <TopBar
          data={data}
          mode={state.mode}
          onMode={setMode}
          progress={progress}
          onSwitch={onSwitch}
          onPalette={() => setOverlay('palette')}
          onSettings={onSettings}
          onFinish={() => setOverlay('finish')}
        />
        <GrainMap data={data} sections={sections} states={states} stale={stale} current={current} onGo={go} />
        <Outline
          data={data}
          sections={sections}
          states={states}
          stale={stale}
          current={current}
          onGo={go}
          openThreads={(id) => threadsFor(id).filter((t) => !t.resolved).length}
        />
        <BlockView
          data={data}
          block={block}
          mode={state.mode}
          chapterTitle={section.title}
          position={`Block ${section.blocks.indexOf(current) + 1} of ${section.blocks.length}`}
          diffStyle={prefs.diffStyle}
          nextFiles={data.blocks.get(order[order.indexOf(current) + 1])?.files}
          agentName={agentName}
          summaryPending={summaryPending(block.key)}
          onSummarize={summarizeCurrent}
          onDiffStyle={(diffStyle) => setPrefs((p) => ({ ...p, diffStyle }))}
          state={states[current]}
          staleSince={stale[current]}
          comments={blockComments}
          threads={threadsFor(current)}
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
            threads={threadsFor(current)}
            composing={composing}
            agentName={agentName}
            onCompose={setComposing}
            onComment={addComment}
            onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
          />
        ) : (
          <div />
        )}
        <KeyHints
          copy={copy}
          diffStyle={prefs.diffStyle}
          note={[
            copy.order,
            data.review.complete ? null : 'Checking how the changes are used across the repo',
            agentName ? (note ?? `AI on request: ${agentName}`) : 'AI off',
            'Progress is saved on this machine',
          ]
            .filter((x): x is string => !!x).map((s) => s.replace(/\.$/, '')).join('. ') + '.'}
        />
        {overlay === 'palette' && <CommandPalette commands={commands} onClose={() => setOverlay(null)} />}
        {overlay === 'finish' && (
          <FinishDialog
            data={data}
            mode={state.mode}
            states={states}
            comments={state.comments}
            reviewable={reviewable}
            onPosted={(ids) => dispatch({ type: 'posted', ids })}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === 'help' && <ShortcutsDialog onClose={() => setOverlay(null)} />}
        {status?.headSha && base.pr && status.headSha !== base.pr.headSha && <NewCommitsNotice local={!!base.pr.local} onReload={onReload} />}
      </div>
    </ThreadActionsContext>
  )
}
