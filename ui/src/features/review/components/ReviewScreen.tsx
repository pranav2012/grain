import { useEffect, useMemo, useState } from 'react'
import { CommandPalette, type Command } from '@/components/CommandPalette'
import { useHotkeys } from '@/lib/useHotkeys'
import type { Chapter } from '@/types/generated/Chapter'
import { ThreadActionsContext, useConversation } from '../hooks/useConversation'
import { useLiveReview } from '../hooks/useLiveReview'
import { useReviewStatus } from '../hooks/useReviewStatus'
import { useSummaries } from '../hooks/useSummaries'
import { agentName as agentNameOf, blockTitle, chapterSummaryKey, chapterSummaryOf } from '../model/describe'
import { modeOrder, modes } from '../model/modes'
import { blockProgress } from '../model/progress'
import { chapterBlocks, chaptersFor, linesOf, ownedBlocks } from '../model/story'
import { reviewApi } from '../api'
import type { Ask, BlockState, LoadedPr, Mode, ReviewComment } from '../model/types'
import { usePrefs } from '../state/usePrefs'
import { useReviewState } from '../state/useReviewState'
import { ChapterView } from './ChapterView'
import { FinishDialog } from './FinishDialog'
import { KeyHints } from './KeyHints'
import { NewCommitsNotice } from './NewCommitsNotice'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StoryToc } from './StoryToc'
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
  const [composeTick, setComposeTick] = useState(0)
  const [asks, setAsks] = useState<Record<string, Ask[]>>({})
  const [focusRequest, setFocusRequest] = useState<{ blockId: number; n: number } | null>(null)
  const copy = modes[state.mode]

  const status = useReviewStatus(base.id, settingsVersion)
  const live = useLiveReview(base, status)
  const baseOrder = useMemo(() => chaptersFor(live, prefs.mineFirst).flatMap(chapterBlocks), [live, prefs.mineFirst])
  const keyToId = useMemo(() => new Map([...live.blocks.values()].map((b) => [b.key, b.id])), [live])
  const current = (state.currentKey && keyToId.get(state.currentKey)) || baseOrder[0]
  const { data, note, request: requestSummary, pending: summaryPending } = useSummaries(live, status, baseOrder, current)

  const { threadsFor, actions: threadActions } = useConversation(data)
  const chapters = useMemo(() => chaptersFor(data, prefs.mineFirst), [data, prefs.mineFirst])
  const order = useMemo(() => chapters.flatMap(chapterBlocks), [chapters])
  const owned = useMemo(() => ownedBlocks(data), [data])
  const { states, stale } = useMemo(() => blockProgress(data, state.verdicts), [data, state.verdicts])
  const chapter = chapters.find((c) => chapterBlocks(c).includes(current)) ?? chapters[0]
  const reviewable = useMemo(() => order.filter((id) => !data.blocks.get(id)!.skim), [order, data])
  const agentName = agentNameOf(data)

  // With AI on, each chapter's short intro is written in the background when the chapter opens (cached).
  useEffect(() => {
    if (agentName && chapter && !chapterSummaryOf(data, chapter)) requestSummary([chapterSummaryKey(chapter)])
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, chapter?.key])

  const focus = (id: number | undefined, scroll = true) => {
    const b = id === undefined ? undefined : data.blocks.get(id)
    if (!b) return
    dispatch({ type: 'go', key: b.key })
    if (scroll) setFocusRequest((r) => ({ blockId: id!, n: (r?.n ?? 0) + 1 }))
  }
  const openChapter = (c: Chapter | undefined) => c && focus(chapterBlocks(c).find((id) => !states[id]) ?? chapterBlocks(c)[0])
  const step = (d: number) => focus(order[Math.min(order.length - 1, Math.max(0, order.indexOf(current) + d))])
  const stepChapter = (d: number) => openChapter(chapters[chapters.indexOf(chapter) + d])
  const nextOpen = () => order.slice(order.indexOf(current) + 1).find((id) => !states[id]) ?? order.find((id) => !states[id])
  const mark = (id: number, v: BlockState | null) => {
    const b = data.blocks.get(id)!
    dispatch({ type: 'mark', key: b.key, verdict: v ? { state: v, hash: b.contentHash, head: data.pr?.headSha ?? '', files: b.files } : null })
  }
  const setMode = (mode: Mode) => dispatch({ type: 'mode', mode })
  const toggleDiffStyle = () => setPrefs((p) => ({ ...p, diffStyle: p.diffStyle === 'split' ? 'unified' : 'split' }))
  const toggleMineFirst = () => setPrefs((p) => ({ ...p, mineFirst: !p.mineFirst }))
  const primary = () => {
    if (states[current] === 'ok') return mark(current, null)
    mark(current, 'ok')
    focus(nextOpen())
  }
  const secondary = () => {
    mark(current, 'change')
    setComposeTick((t) => t + 1)
  }
  const explain = (id: number) => {
    const b = data.blocks.get(id)!
    if (!agentName) return onSettings()
    if (!b.skim) requestSummary([b.key])
  }
  const ask = (blockId: number, question: string, code?: string, about?: string) => {
    const key = data.blocks.get(blockId)!.key
    const id = crypto.randomUUID()
    const update = (patch: Partial<Ask>) => setAsks((all) => ({ ...all, [key]: (all[key] ?? []).map((q) => (q.id === id ? { ...q, ...patch } : q)) }))
    setAsks((all) => ({ ...all, [key]: [...(all[key] ?? []), { id, question, about }] }))
    focus(blockId)
    reviewApi.ask(data.id, { key, question, code: code ?? null }).then(
      (r) => update({ answer: r.answer }),
      (e: Error) => update({ error: e.message }),
    )
  }
  const addComment = (blockId: number, c: NewComment) => dispatch({ type: 'comment', comment: newComment(c, blockId, data.blocks.get(blockId)!.key) })

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    J: () => stepChapter(1),
    K: () => stepChapter(-1),
    ' ': primary,
    x: secondary,
    c: () => setComposeTick((t) => t + 1),
    a: () => explain(current),
    s: toggleDiffStyle,
    m: () => owned.size && toggleMineFirst(),
    '1': () => setMode('self'),
    '2': () => setMode('peer'),
    '3': () => setMode('maintainer'),
    '?': () => setOverlay((o) => (o === 'help' ? null : 'help')),
    ',': onSettings,
    o: onSwitch,
    'Mod+o': onSwitch,
    'Mod+k': () => setOverlay((o) => (o === 'palette' ? null : 'palette')),
    'Shift+Enter': () => setOverlay('finish'),
  })

  const lines = (ids: number[]) => linesOf(data, ids)
  const progress = {
    done: reviewable.filter((id) => states[id]).length,
    total: reviewable.length,
    okLines: lines(reviewable.filter((id) => states[id] === 'ok')),
    changeLines: lines(reviewable.filter((id) => states[id] === 'change')),
    reviewLines: lines(reviewable),
  }
  const commands: Command[] = [
    { id: 'finish', label: copy.finish, hint: 'Shift Enter', run: () => setOverlay('finish') },
    { id: 'switch', label: 'Open another pull request', hint: '⌘O', run: onSwitch },
    { id: 'settings', label: 'Settings: AI', hint: ',', run: onSettings },
    ...modeOrder.map((m, i) => ({ id: `mode-${m}`, label: `Switch to ${modes[m].label.toLowerCase()}`, hint: String(i + 1), run: () => setMode(m) })),
    { id: 'next-open', label: 'Go to the next unreviewed change', run: () => focus(nextOpen()) },
    { id: 'diff-style', label: prefs.diffStyle === 'split' ? 'Show unified diff' : 'Show side-by-side diff', hint: 's', run: toggleDiffStyle },
    ...(owned.size ? [{ id: 'mine-first', label: prefs.mineFirst ? 'Show your code in its flows' : 'Show your code first (CODEOWNERS)', hint: 'm', run: toggleMineFirst }] : []),
    ...chapters.map((c) => ({ id: `ch-${c.key}`, label: c.title, hint: `${chapterBlocks(c).length} changes`, run: () => openChapter(c) })),
    ...order.map((id) => ({ id: `b${id}`, label: blockTitle(data, data.blocks.get(id)!), hint: chapters.find((c) => chapterBlocks(c).includes(id))?.title, run: () => focus(id) })),
  ]

  return (
    <ThreadActionsContext value={threadActions}>
      <div className="grid h-screen grid-cols-[260px_minmax(0,1fr)] grid-rows-[48px_minmax(0,1fr)_30px] [grid-template-areas:'top_top'_'toc_main'_'keys_keys'] max-[900px]:grid-cols-[0_minmax(0,1fr)]">
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
        <StoryToc
          data={data}
          chapters={chapters}
          current={chapter}
          currentBlock={current}
          states={states}
          stale={stale}
          onChapter={openChapter}
          onBlock={(id) => focus(id)}
        />
        <ChapterView
          data={data}
          chapter={chapter}
          next={chapters[chapters.indexOf(chapter) + 1]}
          mode={state.mode}
          diffStyle={prefs.diffStyle}
          states={states}
          stale={stale}
          currentBlock={current}
          comments={state.comments}
          threadsFor={threadsFor}
          owned={owned}
          agentName={agentName}
          summaryPending={summaryPending}
          composeTick={composeTick}
          asksFor={(key) => asks[key] ?? []}
          onAsk={ask}
          focusRequest={focusRequest}
          onFocus={(id) => focus(id, false)}
          onGo={(id) => focus(id)}
          onMark={mark}
          onExplain={explain}
          onApproveAll={() => chapterBlocks(chapter).forEach((id) => mark(id, 'ok'))}
          onDiffStyle={(diffStyle) => setPrefs((p) => ({ ...p, diffStyle }))}
          onNextChapter={() => stepChapter(1)}
          onComment={addComment}
          onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
        />
        <KeyHints
          copy={copy}
          diffStyle={prefs.diffStyle}
          note={[
            data.review.complete ? null : 'Reading the whole repository for user flows',
            agentName ? (note ?? `AI: ${agentName}`) : 'AI off',
            'Progress is saved on this machine',
          ]
            .filter((x): x is string => !!x)
            .join('. ')
            .concat('.')}
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
