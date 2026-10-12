import { useMemo, useState } from 'react'
import { CommandPalette, type Command } from '@/components/CommandPalette'
import { useHotkeys } from '@/lib/useHotkeys'
import { ThreadActionsContext, useConversation } from '../hooks/useConversation'
import { useLiveReview } from '../hooks/useLiveReview'
import { useReviewStatus } from '../hooks/useReviewStatus'
import { useSummaries } from '../hooks/useSummaries'
import { agentName as agentNameOf, layerSummaryKey, layerSummaryOf } from '../model/describe'
import { modeOrder, modes } from '../model/modes'
import { blockProgress } from '../model/progress'
import { ownedBlocks, stagesFor, stepState, stepTitle } from '../model/steps'
import type { CommentKind, LoadedPr, Mode, ReviewComment, Stage, Step } from '../model/types'
import { usePrefs } from '../state/usePrefs'
import { useReviewState } from '../state/useReviewState'
import { ContextPanel } from './ContextPanel'
import { FinishDialog } from './FinishDialog'
import { KeyHints } from './KeyHints'
import { NewCommitsNotice } from './NewCommitsNotice'
import { Overview } from './Overview'
import { ShortcutsDialog } from './ShortcutsDialog'
import { StageRail } from './StageRail'
import { StepView } from './StepView'
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
  const [composing, setComposing] = useState<{ kind: CommentKind; body?: string } | null>(null)
  // A fresh review opens on the overview; one in progress goes straight back to the reader's step.
  const [view, setView] = useState<'overview' | 'step'>(() => (Object.keys(state.verdicts).length ? 'step' : 'overview'))
  const copy = modes[state.mode]

  const status = useReviewStatus(base.id, settingsVersion)
  const live = useLiveReview(base, status)
  const baseSteps = useMemo(() => stagesFor(live, state.mode, prefs.mineFirst).flatMap((s) => s.steps), [live, state.mode, prefs.mineFirst])
  const baseOrder = useMemo(() => baseSteps.flatMap((s) => s.blocks), [baseSteps])
  const keyToId = useMemo(() => new Map([...live.blocks.values()].map((b) => [b.key, b.id])), [live])
  const currentBlock = (state.currentKey && keyToId.get(state.currentKey)) || baseOrder[0]
  const { data, note, request: requestSummary, pending: summaryPending } = useSummaries(live, status, baseOrder, currentBlock)

  const { threadsFor, actions: threadActions } = useConversation(data)
  const stages = useMemo(() => stagesFor(data, state.mode, prefs.mineFirst), [data, state.mode, prefs.mineFirst])
  const steps = useMemo(() => stages.flatMap((s) => s.steps), [stages])
  const owned = useMemo(() => ownedBlocks(data), [data])
  const { states, stale } = useMemo(() => blockProgress(data, state.verdicts), [data, state.verdicts])
  const step = steps.find((s) => s.blocks.includes(currentBlock)) ?? steps[0]
  const stage = stages.find((s) => s.steps.includes(step))!
  const reviewable = useMemo(() => steps.flatMap((s) => s.blocks).filter((id) => !data.blocks.get(id)!.skim), [steps, data])
  const stepBlocks = step.blocks.map((id) => data.blocks.get(id)!)
  const stepKeys = new Set(stepBlocks.map((b) => b.key))
  const stepComments = state.comments.filter((c) => stepKeys.has(c.blockKey))
  const st = stepState(step, states)
  const staleSince = step.blocks.map((id) => stale[id]).find(Boolean)
  const agentName = agentNameOf(data)

  const goStep = (s: Step | undefined) => {
    if (!s) return
    dispatch({ type: 'go', key: data.blocks.get(s.blocks[0])!.key })
    setView('step')
    setComposing(null)
  }
  const openStage = (s: Stage) => goStep(s.steps.find((x) => stepState(x, states) !== 'done') ?? s.steps[0])
  const idx = steps.indexOf(step)
  const nextOpen = () => steps.slice(idx + 1).find((s) => stepState(s, states) !== 'done') ?? steps.find((s) => stepState(s, states) !== 'done')
  const firstOpen = () => steps.find((s) => stepState(s, states) !== 'done')
  const stepBy = (d: number) => goStep(steps[Math.min(steps.length - 1, Math.max(0, idx + d))])
  const stageBy = (d: number) => {
    const s = stages[stages.indexOf(stage) + d]
    if (s) openStage(s)
  }
  const verdict = (b: (typeof stepBlocks)[number], v: 'ok' | 'change') => ({ state: v, hash: b.contentHash, head: data.pr?.headSha ?? '', files: b.files })
  const markStep = (v: 'ok' | 'change' | null) =>
    stepBlocks.forEach((b) => dispatch({ type: 'mark', key: b.key, verdict: v ? verdict(b, v) : null }))
  const setMode = (mode: Mode) => dispatch({ type: 'mode', mode })
  const toggleDiffStyle = () => setPrefs((p) => ({ ...p, diffStyle: p.diffStyle === 'split' ? 'unified' : 'split' }))
  const toggleMineFirst = () => setPrefs((p) => ({ ...p, mineFirst: !p.mineFirst }))
  const compose = (kind: CommentKind) => {
    setShowContext(true)
    setComposing({ kind })
  }
  const primary = () => {
    if (view === 'overview') return goStep(firstOpen() ?? steps[0])
    if (st === 'done') return markStep(null)
    markStep('ok')
    goStep(nextOpen())
  }
  const secondary = () => {
    if (view === 'overview') return
    markStep('change')
    compose(copy.secondaryKind)
  }
  const addComment = (blockId: number, c: NewComment) => dispatch({ type: 'comment', comment: newComment(c, blockId, data.blocks.get(blockId)!.key) })
  const explainStep = () => agentName && step.layer && requestSummary([layerSummaryKey(step.layer)])
  const byLayer = (id: number) => steps.find((s) => s.layer?.id === id)
  const uses = (step.layer?.uses ?? []).map(byLayer).filter((s): s is Step => !!s)
  const usedBy = steps.filter((s) => step.layer && s.layer?.uses.includes(step.layer.id))

  useHotkeys({
    j: () => stepBy(1),
    k: () => stepBy(-1),
    J: () => stageBy(1),
    K: () => stageBy(-1),
    h: () => setView('overview'),
    ' ': primary,
    x: secondary,
    c: () => view === 'step' && compose(copy.kinds[0][0]),
    s: toggleDiffStyle,
    m: () => owned.size && toggleMineFirst(),
    a: () => {
      if (agentName) explainStep()
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
    done: steps.filter((s) => stepState(s, states) === 'done').length,
    total: steps.length,
    okLines: lines(reviewable.filter((id) => states[id] === 'ok')),
    changeLines: lines(reviewable.filter((id) => states[id] === 'change')),
    reviewLines: lines(reviewable),
  }
  const commands: Command[] = [
    { id: 'finish', label: copy.finish, hint: 'Shift Enter', run: () => setOverlay('finish') },
    { id: 'overview', label: 'Back to the overview', hint: 'h', run: () => setView('overview') },
    { id: 'switch', label: 'Open another pull request', hint: '⌘O', run: onSwitch },
    { id: 'settings', label: 'Settings: AI', hint: ',', run: onSettings },
    ...modeOrder.map((m, i) => ({ id: `mode-${m}`, label: `Switch to ${modes[m].label.toLowerCase()}`, hint: String(i + 1), run: () => setMode(m) })),
    { id: 'next-open', label: 'Go to the next unreviewed step', run: () => goStep(nextOpen()) },
    ...(agentName && step.layer && !layerSummaryOf(data, step.layer) ? [{ id: 'explain', label: `Explain this step with ${agentName}`, hint: 'a', run: explainStep }] : []),
    { id: 'diff-style', label: prefs.diffStyle === 'split' ? 'Show unified diff' : 'Show side-by-side diff', hint: 's', run: toggleDiffStyle },
    ...(owned.size
      ? [{ id: 'mine-first', label: prefs.mineFirst ? 'Show steps in normal order' : 'Show your code first (CODEOWNERS)', hint: 'm', run: toggleMineFirst }]
      : []),
    { id: 'context', label: showContext ? 'Hide the side panel' : 'Show the side panel', hint: ']', run: () => setShowContext((v) => !v) },
    ...stages.map((s) => ({ id: `stage-${s.name}`, label: `Stage: ${s.name}`, hint: `${s.steps.length} steps`, run: () => openStage(s) })),
    ...steps.map((s) => ({ id: `step-${s.key}`, label: stepTitle(data, s), hint: s.stage, run: () => goStep(s) })),
  ]
  const panel = view === 'step' && showContext

  return (
    <ThreadActionsContext value={threadActions}>
      <div
        className={`grid h-screen grid-rows-[48px_minmax(0,1fr)_30px] [grid-template-areas:'top_top_top'_'rail_main_context'_'keys_keys_keys'] max-[1100px]:grid-cols-[180px_minmax(0,1fr)_0] max-[760px]:grid-cols-[0_minmax(0,1fr)_0] ${
          panel ? 'grid-cols-[200px_minmax(0,1fr)_320px]' : 'grid-cols-[200px_minmax(0,1fr)_0]'
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
        <StageRail stages={stages} current={view === 'step' ? stage : null} states={states} onOverview={() => setView('overview')} onOpenStage={openStage} />
        {view === 'overview' ? (
          <Overview data={data} stages={stages} states={states} resume={firstOpen()} onOpenStage={openStage} onOpenStep={goStep} />
        ) : (
          <StepView
            data={data}
            step={step}
            stage={stage.name}
            position={stage.steps.indexOf(step) + 1}
            of={stage.steps.length}
            next={steps[idx + 1]}
            mode={state.mode}
            diffStyle={prefs.diffStyle}
            state={st}
            staleSince={staleSince}
            comments={stepComments}
            threadsFor={threadsFor}
            owned={step.blocks.some((id) => owned.has(id))}
            agentName={agentName}
            summaryPending={!!step.layer && summaryPending(layerSummaryKey(step.layer))}
            onSummarize={explainStep}
            onOverview={() => setView('overview')}
            onDiffStyle={(diffStyle) => setPrefs((p) => ({ ...p, diffStyle }))}
            onPrimary={primary}
            onSecondary={secondary}
            onNext={() => stepBy(1)}
            onComment={addComment}
            onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
          />
        )}
        {panel ? (
          <ContextPanel
            data={data}
            step={step}
            mode={state.mode}
            comments={stepComments}
            threads={step.blocks.flatMap((id) => threadsFor(id))}
            uses={uses}
            usedBy={usedBy}
            composing={composing}
            agentName={agentName}
            onCompose={setComposing}
            onComment={(c) => addComment(step.blocks[0], c)}
            onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
            onOpenStep={goStep}
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
            .filter((x): x is string => !!x)
            .map((s) => s.replace(/\.$/, ''))
            .join('. ') + '.'}
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
