import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileDiffLoadedFiles, FileDiffMetadata } from '@pierre/diffs'
import { CommandPalette, type Command } from '@/components/CommandPalette'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { pickFolder } from '@/lib/pick-folder'
import { useHotkeys } from '@/lib/useHotkeys'
import { reviewApi } from '../api'
import { ThreadActionsContext, useConversation } from '../hooks/useConversation'
import { useChecks } from '../hooks/useChecks'
import { useLiveReview } from '../hooks/useLiveReview'
import { usePrDiff } from '../hooks/usePrDiff'
import { useReviewStatus } from '../hooks/useReviewStatus'
import { useSummaries } from '../hooks/useSummaries'
import { agentName as agentNameOf, chapterSummaryKey, chapterSummaryOf, isTestPath } from '../model/describe'
import { blocksByFile, fileChapters, filesInOrder, usedBy } from '../model/files'
import { modeOrder, modes } from '../model/modes'
import { allProblems, changedLines, problemsByFile, type FileProblems } from '../model/problems'
import { findingKey, rowFor } from '../model/findings'
import { chaptersFor, ownedBlocks } from '../model/story'
import type { Ask, CommentKind, LineThread, LoadedPr, Mode, ReviewComment, Side } from '../model/types'
import type { Finding } from '@/types/generated/Finding'
import type { Settings } from '@/types/generated/Settings'
import { usePrefs } from '../state/usePrefs'
import { useReviewState } from '../state/useReviewState'
import { FileCard, type NewComment, type ThreadAnchor } from './FileCard'
import { CommentsRail } from './CommentsRail'
import { CodeModal, type CodeLocation } from './CodeModal'
import { FinishDialog } from './FinishDialog'
import { KeyHints } from './KeyHints'
import { NewCommitsNotice } from './NewCommitsNotice'
import { Outline } from './Outline'
import { Overview } from './Overview'
import { PrPage, type PrPageHandle } from './PrPage'
import { ProblemsPill } from './ProblemsPill'
import { SpendChip } from './SpendChip'
import { ShortcutsDialog } from './ShortcutsDialog'
import { TopBar } from './TopBar'

/** Diffs bigger than this start collapsed so the page stays quick to scan. */
const LARGE_FILE = 1500
const noProblems: FileProblems = { shown: [], other: [] }
const noLines: number[] = []
const noFindings: [string, Finding][] = []

interface ReviewScreenProps {
  base: LoadedPr
  settingsVersion: number
  onSwitch(): void
  onSettings(): void
  onReload(): void
}

export function ReviewScreen({ base, settingsVersion, onSwitch, onSettings, onReload }: ReviewScreenProps) {
  const viewer = base.pr?.viewer
  const [state, dispatch] = useReviewState(base, viewer && viewer === base.pr?.author.login ? 'self' : 'peer')
  const [prefs, setPrefs] = usePrefs()
  const [overlay, setOverlay] = useState<'palette' | 'finish' | 'help' | null>(null)
  const [lineThreads, setLineThreads] = useState<LineThread[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [canGoBack, setCanGoBack] = useState(false)
  const page = useRef<PrPageHandle>(null)
  const copy = modes[state.mode]
  const head = base.pr?.headSha ?? ''

  const status = useReviewStatus(base.id, settingsVersion)
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    reviewApi.settings().then(setSettings, () => {})
  }, [settingsVersion])
  const live = useLiveReview(base, status)
  const byFile = useMemo(() => blocksByFile(live), [live])
  const blockOrder = useMemo(() => chaptersFor(live, prefs.mineFirst).flatMap((c) => c.sections.flatMap((s) => s.blocks)), [live, prefs.mineFirst])
  const currentBlock = byFile.get(state.currentFile ?? '')?.[0] ?? blockOrder[0]
  const { data, note, request: requestSummary } = useSummaries(live, status, blockOrder, currentBlock)
  const { conversation, actions: threadActions } = useConversation(data)
  const { patches, error: diffError } = usePrDiff(data.id, head)
  const agentName = agentNameOf(data)
  const { report, prStatus, freshness, diagnosing, rerun, ai, reviewing, rereview, uses } = useChecks(data.id, !!base.pr?.local, status)
  const [railHidden, setRailHidden] = useState(false)
  const [code, setCode] = useState<CodeLocation | null>(null)

  const allFiles = useMemo(() => (patches ? [...patches.keys()] : [...byFile.keys()]), [patches, byFile])
  const chapters = useMemo(() => fileChapters(data, chaptersFor(data, prefs.mineFirst), allFiles), [data, prefs.mineFirst, allFiles])
  const order = useMemo(() => filesInOrder(chapters), [chapters])
  const problems = useMemo(() => allProblems(report, prStatus, new Set(allFiles)), [report, prStatus, allFiles])
  const fileProblems = useMemo(
    () => problemsByFile(problems, (f) => (patches?.get(f) ? changedLines(patches.get(f)!.diff) : null)),
    [problems, patches],
  )
  const shownProblems = useMemo(() => order.flatMap((f) => fileProblems.get(f)?.shown ?? []), [order, fileProblems])
  const problemMarks = useMemo(
    () => new Map([...fileProblems].filter(([, p]) => p.shown.length).map(([f, p]) => [f, p.shown.some((x) => x.severity === 'error') ? 'error' : 'warning'] as const)),
    [fileProblems],
  )
  const routine = useMemo(() => new Set(chapters.filter((c) => c.chapter.kind === 'routine').flatMap((c) => c.sections.flatMap((s) => s.files))), [chapters])
  const ownedFiles = useMemo(() => {
    const owned = ownedBlocks(data)
    return new Set([...byFile].filter(([, ids]) => ids.some((id) => owned.has(id))).map(([f]) => f))
  }, [data, byFile])

  const viewedEntry = (f: string) => state.viewed[f]
  const isViewed = useCallback(
    (f: string) => {
      const v = state.viewed[f]
      const p = patches?.get(f)
      return !!v && (!v.hash || !p || v.hash === p.hash)
    },
    [state.viewed, patches],
  )
  const isCollapsed = (f: string) => {
    if (f in collapsed) return collapsed[f]
    const p = patches?.get(f)
    return isViewed(f) || isTestPath(f) || routine.has(f) || (!!p && p.added + p.removed > LARGE_FILE)
  }

  // Progress carried over from older Grain versions has no diff hash yet; pin it to what's shown now.
  useEffect(() => {
    if (!patches) return
    const unpinned = Object.entries(state.viewed).filter(([f, v]) => !v.hash && patches.has(f))
    if (unpinned.length) dispatch({ type: 'view', files: unpinned.map(([f]) => f), viewed: unpinned.map(([f, v]) => ({ ...v, hash: patches.get(f)!.hash })) })
  }, [patches, state.viewed, dispatch])

  const restored = useRef(false)
  useEffect(() => {
    if (!patches || restored.current) return
    restored.current = true
    if (state.currentFile && order.includes(state.currentFile)) requestAnimationFrame(() => page.current?.jump(state.currentFile!, false))
  }, [patches, order, state.currentFile])

  const chapter = chapters.find((c) => [...c.sections.flatMap((s) => s.files), ...c.tests].includes(state.currentFile ?? '')) ?? chapters[0]
  // With AI on, each chapter's short intro is written in the background when the chapter is reached (cached).
  useEffect(() => {
    if (agentName && chapter && !chapterSummaryOf(data, chapter.chapter)) requestSummary([chapterSummaryKey(chapter.chapter)])
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName, chapter?.chapter.key])

  const onCurrent = useCallback((file: string) => dispatch({ type: 'go', file }), [dispatch])
  const jump = (file: string | undefined, remember = true) => {
    if (!file) return
    setCollapsed((c) => (isCollapsed(file) ? { ...c, [file]: false } : c))
    requestAnimationFrame(() => page.current?.jump(file, remember))
  }
  const index = Math.max(0, order.indexOf(state.currentFile ?? order[0]))
  const step = (d: number) => {
    const file = order[Math.min(order.length - 1, Math.max(0, index + d))]
    if (file) page.current?.jump(file, false)
  }
  const stepChapter = (d: number) => {
    const next = chapters[chapters.indexOf(chapter) + d]
    const first = next && [...next.sections.flatMap((s) => s.files), ...next.tests][0]
    if (first) page.current?.jump(first, false)
  }
  const setViewed = (files: string[], on: boolean) => {
    dispatch({ type: 'view', files, viewed: on ? files.map((f) => ({ hash: patches?.get(f)?.hash ?? '', head })) : null })
    setCollapsed((c) => {
      const next = { ...c }
      for (const f of files) delete next[f]
      return next
    })
  }
  const toggleViewedAndNext = () => {
    const f = order[index]
    if (!f) return
    const on = !isViewed(f)
    setViewed([f], on)
    if (on) {
      const next = order.slice(index + 1).find((x) => !isViewed(x))
      if (next) requestAnimationFrame(() => page.current?.jump(next, false))
    }
  }

  const problemAt = useRef(-1)
  const revealProblem = (id: string) => {
    const x = shownProblems.find((p) => p.id === id)
    if (!x) return
    problemAt.current = shownProblems.indexOf(x)
    setCollapsed((c) => ({ ...c, [x.file]: false }))
    requestAnimationFrame(() => page.current?.reveal(x.file, (section) => section.querySelector<HTMLElement>(`#problem-${CSS.escape(x.id)}`)))
  }
  const nextProblem = () => shownProblems.length && revealProblem(shownProblems[(problemAt.current + 1) % shownProblems.length].id)
  const chooseClone = () => {
    const repo = data.id.split('/').slice(0, 2).join('/')
    pickFolder(`Choose your clone of ${repo}`).then(
      (path) => {
        if (path) reviewApi.setLocalRepo(repo, path).then(rerun, () => {})
      },
      () => {},
    )
  }

  const findings = useMemo(() => {
    const at = new Map(order.map((f, i) => [f, i]))
    return [...(ai?.findings ?? [])].sort((a, b) => (at.get(a.file) ?? 1e9) - (at.get(b.file) ?? 1e9) || a.line - b.line)
  }, [ai, order])
  const findingLines = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const f of findings) map.set(f.file, [...(map.get(f.file) ?? []), f.line])
    return map
  }, [findings])
  // Waiting for the reviewer: no call yet, or kept as a draft that was since deleted.
  const waitingByFile = useMemo(() => {
    const ids = new Set(state.comments.map((c) => c.id))
    const map = new Map<string, [string, Finding][]>()
    for (const f of findings) {
      const call = state.ai?.[findingKey(f)]
      if (call && (call === 'dismissed' || ids.has(call.kept))) continue
      map.set(f.file, [...(map.get(f.file) ?? []), [findingKey(f), f]])
    }
    return map
  }, [findings, state.ai, state.comments])
  const [editing, setEditing] = useState<string | null>(null)
  const aiShown = !!agentName && (reviewing || !!ai)
  const drafts = state.comments.filter((c) => c.file && !c.postedAt).length
  const commentCount = (conversation?.threads.length ?? 0) + drafts
  const aiOff = !!settings && !settings.agent
  const railAvailable = aiShown || commentCount > 0 || aiOff
  const showRail = !railHidden && railAvailable
  const findingAt = useRef(-1)
  const revealFinding = (f: Finding) => {
    findingAt.current = findings.indexOf(f)
    setCollapsed((c) => ({ ...c, [f.file]: false }))
    setRailHidden(false)
    requestAnimationFrame(() => page.current?.reveal(f.file, (section) => rowFor(section, f.line)))
  }
  const stepFinding = (d: number) => findings.length && revealFinding(findings[(findingAt.current + d + findings.length) % findings.length])
  const keepFinding = (f: Finding, edited?: { body: string; kind: CommentKind; suggestion?: string }) => {
    const id = crypto.randomUUID()
    const body = edited ? { body: edited.body, kind: edited.kind, suggestion: edited.suggestion } : { body: f.comment, kind: 'comment' as const }
    dispatch({ type: 'comment', comment: { id, blockId: 0, blockKey: f.file, ...body, file: f.file, side: 'additions', line: f.line, endLine: f.endLine, createdAt: Date.now() } })
    dispatch({ type: 'ai', key: findingKey(f), call: { kept: id } })
  }
  const undoFinding = (f: Finding) => {
    const call = state.ai?.[findingKey(f)]
    if (call && call !== 'dismissed') dispatch({ type: 'deleteComment', id: call.kept })
    dispatch({ type: 'ai', key: findingKey(f), call: null })
  }

  const setMode = (mode: Mode) => dispatch({ type: 'mode', mode })
  const toggleDiffStyle = () => setPrefs((p) => ({ ...p, diffStyle: p.diffStyle === 'split' ? 'unified' : 'split' }))
  const toggleMineFirst = () => setPrefs((p) => ({ ...p, mineFirst: !p.mineFirst }))
  const back = () => page.current?.back()
  const revealLine = (file: string, line: number) => {
    setCollapsed((c) => ({ ...c, [file]: false }))
    requestAnimationFrame(() => page.current?.reveal(file, (section) => rowFor(section, line)))
  }
  const revealComment = (file: string, line: number | null, side: Side) => {
    setCollapsed((c) => ({ ...c, [file]: false }))
    const row = (section: Element) => (line === null ? section.querySelector<HTMLElement>('header') : rowFor(section, line, side))
    requestAnimationFrame(() => page.current?.reveal(file, row))
  }
  const githubUrl = useMemo(() => {
    if (!data.pr || data.pr.local) return undefined
    const repo = data.id.split('/').slice(0, 2).join('/')
    const head = data.pr.headSha
    return (file: string, line: number) => `https://github.com/${repo}/blob/${head}/${file}#L${line}`
  }, [data.pr, data.id])
  const scroller = useCallback(() => page.current?.scroller() ?? null, [])
  const inPr = useCallback((file: string) => order.includes(file), [order])
  const loadFiles = useCallback(
    async (diff: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
      const [oldContents, newContents] = await Promise.all([reviewApi.source(data.id, diff.prevName ?? diff.name, 'base'), reviewApi.source(data.id, diff.name)])
      return { oldFile: { name: diff.prevName ?? diff.name, contents: oldContents }, newFile: { name: diff.name, contents: newContents } }
    },
    [data.id],
  )

  /** Sends a question to the agent; `history` (earlier questions and answers) keeps follow-ups in context. */
  const askAgent = (file: string, question: string, code: string | undefined, history: Ask[], done: (patch: Partial<Ask>) => void) => {
    const earlier = history.filter((m) => m.answer).map((m) => `Q: ${m.question}\nA: ${m.answer}`).join('\n\n')
    const full = earlier ? `Earlier in this conversation:\n${earlier}\n\nFollow-up: ${question}` : question
    const block = data.blocks.get(byFile.get(file)?.[0] ?? -1)
    reviewApi.ask(data.id, { key: block?.key ?? file, question: full, code: code ?? null }).then(
      (r) => done({ answer: r.answer }),
      (e: Error) => done({ error: e.message }),
    )
  }
  const patchMessage = (threadId: string, messageId: string, patch: Partial<Ask>) =>
    setLineThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) } : t)))
  const askAt = (anchor: ThreadAnchor, question: string) => {
    const thread: LineThread = { ...anchor, id: crypto.randomUUID(), blockId: 0, messages: [{ id: crypto.randomUUID(), question }], open: true }
    setLineThreads((ts) => [...ts, thread])
    askAgent(anchor.file, question, anchor.code, [], (patch) => patchMessage(thread.id, thread.messages[0].id, patch))
  }
  const followUp = (threadId: string, question: string) => {
    const thread = lineThreads.find((t) => t.id === threadId)
    if (!thread) return
    const message = { id: crypto.randomUUID(), question }
    setLineThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, message] } : t)))
    askAgent(thread.file, question, thread.code, thread.messages, (patch) => patchMessage(threadId, message.id, patch))
  }
  const retry = (threadId: string, messageId: string) => {
    const thread = lineThreads.find((t) => t.id === threadId)
    const at = thread?.messages.findIndex((m) => m.id === messageId) ?? -1
    if (!thread || at < 0) return
    patchMessage(threadId, messageId, { error: undefined })
    askAgent(thread.file, thread.messages[at].question, thread.code, thread.messages.slice(0, at), (patch) => patchMessage(threadId, messageId, patch))
  }
  const addComment = (c: NewComment) => {
    const comment: ReviewComment = { ...c, blockId: 0, blockKey: c.file ?? '', id: crypto.randomUUID(), createdAt: Date.now() }
    dispatch({ type: 'comment', comment })
  }

  useHotkeys({
    j: () => step(1),
    k: () => step(-1),
    J: () => stepChapter(1),
    K: () => stepChapter(-1),
    v: toggleViewedAndNext,
    b: back,
    e: nextProblem,
    n: () => stepFinding(1),
    p: () => stepFinding(-1),
    a: () => railAvailable && setRailHidden((h) => !h),
    s: toggleDiffStyle,
    m: () => ownedFiles.size && toggleMineFirst(),
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

  const viewedCount = order.filter(isViewed).length
  const commands: Command[] = [
    { id: 'finish', label: copy.finish, hint: 'Shift Enter', run: () => setOverlay('finish') },
    { id: 'switch', label: 'Open another pull request', hint: '⌘O', run: onSwitch },
    { id: 'settings', label: 'Settings: AI', hint: ',', run: onSettings },
    ...modeOrder.map((m, i) => ({ id: `mode-${m}`, label: `Switch to ${modes[m].label.toLowerCase()}`, hint: String(i + 1), run: () => setMode(m) })),
    { id: 'next-open', label: 'Go to the next file not viewed', run: () => jump(order.slice(index + 1).find((f) => !isViewed(f)) ?? order.find((f) => !isViewed(f))) },
    { id: 'diff-style', label: prefs.diffStyle === 'split' ? 'Show unified diff' : 'Show split diff', hint: 's', run: toggleDiffStyle },
    ...(ownedFiles.size ? [{ id: 'mine-first', label: prefs.mineFirst ? 'Show your code in its flows' : 'Show your code first (CODEOWNERS)', hint: 'm', run: toggleMineFirst }] : []),
    ...chapters.map((c) => ({ id: `ch-${c.chapter.key}`, label: c.chapter.title, hint: 'chapter', run: () => jump([...c.sections.flatMap((s) => s.files), ...c.tests][0]) })),
    ...order.map((f) => ({ id: `f-${f}`, label: f, run: () => jump(f) })),
  ]

  const chapterOf = new Map(chapters.flatMap((c) => [...c.sections.flatMap((s) => s.files), ...c.tests].map((f) => [f, c.chapter.title] as const)))
  const renderFile = (f: string, stuck: boolean) => {
    const v = viewedEntry(f)
    const p = patches ? (patches.get(f) ?? null) : undefined
    const blocks = (byFile.get(f) ?? []).map((id) => data.blocks.get(id)!).filter(Boolean)
    return (
      <FileCard
        path={f}
        patch={p}
        chapterTitle={chapterOf.get(f) ?? ''}
        stuck={stuck}
        collapsed={isCollapsed(f)}
        viewed={isViewed(f)}
        changedSinceViewed={!!v && !isViewed(f)}
        test={isTestPath(f)}
        lastChange={data.owners.lastChange?.[f]}
        diffStyle={p?.diff.type === 'new' || p?.diff.type === 'deleted' ? 'unified' : prefs.diffStyle}
        usedBy={usedBy(data, f)}
        checks={blocks.flatMap((b) => b.checks)}
        comments={state.comments.filter((c) => c.file === f)}
        threads={conversation?.threads.filter((t) => t.path === f) ?? []}
        aiThreads={lineThreads.filter((t) => t.file === f)}
        problems={fileProblems.get(f) ?? noProblems}
        findingLines={findingLines.get(f) ?? noLines}
        findings={waitingByFile.get(f) ?? noFindings}
        editing={editing}
        onEditing={setEditing}
        onEditComment={(id, body, kind, suggestion) => dispatch({ type: 'editComment', id, body, kind, suggestion })}
        onKeepFinding={keepFinding}
        onDismissFinding={(x) => dispatch({ type: 'ai', key: findingKey(x), call: 'dismissed' })}
        agentName={agentName}
        kinds={copy.kinds}
        onCollapse={(c) => setCollapsed((all) => ({ ...all, [f]: c }))}
        onViewed={(on) => setViewed([f], on)}
        onJump={(to, line) => (line ? revealLine(to, line) : jump(to))}
        outsideUses={uses && uses.head === head ? (uses.files[f] ?? null) : diagnosing || !uses ? undefined : null}
        loadFiles={loadFiles}
        inPr={inPr}
        onOpenCode={setCode}
        githubUrl={githubUrl}
        onLookup={(t, references) => reviewApi.navigate(data.id, { file: f, line: t.line, character: t.character, name: t.name, references, oldSide: t.oldSide })}
        onComment={addComment}
        onDeleteComment={(id) => dispatch({ type: 'deleteComment', id })}
        onAskAt={askAt}
        onFollowUp={followUp}
        onRetry={retry}
        onToggleThread={(id, open) => setLineThreads((ts) => ts.map((t) => (t.id === id ? { ...t, open } : t)))}
      />
    )
  }

  return (
    <ThreadActionsContext value={threadActions}>
      <div
        className={cn(
          'grid h-screen grid-rows-[48px_minmax(0,1fr)_30px]',
          showRail
            ? "grid-cols-[272px_minmax(0,1fr)_300px] [grid-template-areas:'top_top_top'_'toc_main_rail'_'keys_keys_keys'] max-[1100px]:grid-cols-[0_minmax(0,1fr)_280px]"
            : "grid-cols-[272px_minmax(0,1fr)] [grid-template-areas:'top_top'_'toc_main'_'keys_keys'] max-[900px]:grid-cols-[0_minmax(0,1fr)]",
        )}
      >
        <TopBar
          data={data}
          mode={state.mode}
          onMode={setMode}
          viewed={viewedCount}
          total={order.length}
          diffStyle={prefs.diffStyle}
          onDiffStyle={(diffStyle) => setPrefs((p) => ({ ...p, diffStyle }))}
          problems={
            <>
              <ProblemsPill
                problems={shownProblems}
                report={report}
                diagnosing={diagnosing}
                onNext={nextProblem}
                onChooseClone={chooseClone}
                noWorkFolders={!!settings && settings.workFolders.length === 0}
                onAddWorkFolder={onSettings}
              />
              {settings && !settings.agent && (
                <Button size="sm" variant="ghost" title="Get a second opinion on every PR from Claude Code, Codex or OpenCode, run read-only on your machine" onClick={onSettings} className="whitespace-nowrap">
                  <span className="text-2xs font-semibold text-accent">AI</span> off · turn on
                </Button>
              )}
              {railAvailable && (
                <Button size="sm" variant="ghost" aria-pressed={!railHidden} title="Show or hide the comments column (a)" onClick={() => setRailHidden((h) => !h)} className="whitespace-nowrap">
                  {aiShown && <span className="text-2xs font-semibold text-accent">AI</span>}
                  {aiShown && (reviewing && !ai ? 'reviewing…' : `${findings.filter((f) => !state.ai?.[findingKey(f)]).length} to check`)}
                  {aiShown && commentCount > 0 && <span className="text-fg-faint">·</span>}
                  {commentCount > 0 && `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}
                  {!aiShown && commentCount === 0 && 'Comments'}
                </Button>
              )}
              {agentName && status && <SpendChip spend={status.spend} />}
            </>
          }
          onSwitch={onSwitch}
          onPalette={() => setOverlay('palette')}
          onSettings={onSettings}
          onFinish={() => setOverlay('finish')}
        />
        <Outline chapters={chapters} patches={patches} current={state.currentFile} isViewed={isViewed} marks={problemMarks} onJump={(f) => jump(f)} onOverview={() => page.current?.top()} />
        {diffError ? (
          <p className="m-auto text-danger [grid-area:main]">{diffError}</p>
        ) : (
          <PrPage
            ref={page}
            data={data}
            chapters={chapters}
            overview={<Overview data={data} chapters={chapters} patches={patches} problems={shownProblems} findings={findings.filter((f) => f.score >= 75 && !state.ai?.[findingKey(f)])} status={prStatus} freshness={freshness} threads={conversation?.threads ?? []} onJump={(f) => jump(f)} onProblem={revealProblem} onFinding={revealFinding} onThread={revealLine} />}
            renderFile={renderFile}
            onCurrent={onCurrent}
            onBackChange={setCanGoBack}
            onViewAll={(files) => setViewed(files, true)}
          />
        )}
        {showRail && (
          <CommentsRail
            review={agentName ? ai : undefined}
            reviewing={reviewing}
            agentName={agentName ?? ''}
            calls={state.ai ?? {}}
            order={order}
            threads={conversation?.threads ?? []}
            comments={state.comments}
            scroller={scroller}
            onKeep={keepFinding}
            onDismiss={(f) => dispatch({ type: 'ai', key: findingKey(f), call: 'dismissed' })}
            onUndo={undoFinding}
            onEdit={(id, file, line, side) => {
              setEditing(id)
              revealComment(file, line, side)
            }}
            onReveal={revealComment}
            aiOff={aiOff}
            onTurnOnAi={onSettings}
            onRetry={rereview}
          />
        )}
        <KeyHints
          note={[
            !patches && 'Loading the diff',
            data.review.complete ? null : 'Reading the whole repository for user flows',
            agentName ? (note ?? `AI: ${agentName}`) : 'AI off',
            'Progress is saved on this machine',
          ]
            .filter((x): x is string => !!x)
            .join('. ')
            .concat('.')}
        />
        {canGoBack && (
          <Button variant="primary" onClick={back} className="fixed bottom-11 left-1/2 z-30 -translate-x-1/2 rounded-full shadow-overlay">
            ← Back <Kbd>b</Kbd>
          </Button>
        )}
        {code && (
          <CodeModal
            prId={data.id}
            start={code}
            githubUrl={githubUrl}
            changedLines={(file) => (patches?.get(file) ? changedLines(patches.get(file)!.diff) : null)}
            onGoToReview={(file, line) => (setCode(null), revealLine(file, line))}
            onClose={() => setCode(null)}
          />
        )}
        {overlay === 'palette' && <CommandPalette commands={commands} onClose={() => setOverlay(null)} />}
        {overlay === 'finish' && (
          <FinishDialog
            data={data}
            mode={state.mode}
            viewed={viewedCount}
            total={order.length}
            comments={state.comments}
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
