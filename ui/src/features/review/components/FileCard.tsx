import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiffLineAnnotation, FileDiffOptions } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { Badge } from '@/components/ui/Badge'
import { Button, LinkButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Check } from '@/types/generated/Check'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import type { FilePatch } from '../hooks/usePrDiff'
import type { UsedBy } from '../model/files'
import type { FileProblems } from '../model/problems'
import { markFindings, markProblems, squiggleCSS } from '../model/squiggles'
import { newLines } from '../model/suggestion'
import type { CommentKind, DiffStyle, LineThread, ReviewComment, Side } from '../model/types'
import { AiThread, ThreadMessages } from './AiThread'
import { CodePeek, type Peek } from './CodePeek'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ProblemRow } from './ProblemRow'
import { ThreadCard } from './ThreadCard'

type Note = { kind: 'draft' } | { kind: 'peek' } | { kind: 'ai'; id: string } | { kind: 'note'; id: string } | { kind: 'thread'; id: string } | { kind: 'problem'; id: string }
export type NewComment = Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>
export type ThreadAnchor = Pick<LineThread, 'file' | 'side' | 'line' | 'about' | 'code'>

interface Draft {
  side: Side
  line: number
  endLine: number
  body?: string
}

export interface FileCardProps {
  path: string
  patch: FilePatch | null | undefined
  chapterTitle: string
  stuck: boolean
  collapsed: boolean
  viewed: boolean
  changedSinceViewed: boolean
  test: boolean
  owned: boolean
  diffStyle: DiffStyle
  usedBy: UsedBy
  checks: Check[]
  comments: ReviewComment[]
  threads: ReviewThread[]
  aiThreads: LineThread[]
  problems: FileProblems
  /** Lines the agent's second opinion comments on. */
  findingLines: number[]
  agentName: string | null
  kinds: [CommentKind, string][]
  onCollapse(collapsed: boolean): void
  onViewed(viewed: boolean): void
  onJump(path: string): void
  onLookup(token: { line: number; character: number; name: string }, references: boolean): Promise<Peek['result']>
  onComment(c: NewComment): void
  onDeleteComment(id: string): void
  onAskAt(anchor: ThreadAnchor, question: string): void
  onFollowUp(threadId: string, question: string): void
  onRetry(threadId: string, messageId: string): void
  onToggleThread(threadId: string, open: boolean): void
}

const baseOptions: FileDiffOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  disableFileHeader: true,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  hunkSeparators: 'line-info',
  lineDiffType: 'word-alt',
  unsafeCSS: `* { --diffs-dark-bg: var(--color-canvas) !important; }\n${squiggleCSS}`,
}

const fileName = (p: string) => p.split('/').pop()!
const dirName = (p: string) => p.split('/').slice(0, -1).join('/')
const stem = (p: string) => fileName(p).replace(/\.[^.]+$/, '')

/** One changed file on the review page: a pinned header, who uses it, then its whole diff with notes under lines. */
export function FileCard(p: FileCardProps) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fileNote, setFileNote] = useState(false)
  const [peek, setPeek] = useState<Peek | null>(null)
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null)
  const sectionRef = useRef<HTMLElement>(null)

  const lookup = (t: { line: number; character: number; name: string; side: Side }, references: boolean) => {
    const next: Peek = { itemId: p.path, line: t.line, side: t.side, name: t.name, references }
    setPeek(next)
    p.onLookup(t, references).then(
      (result) => setPeek((cur) => (cur === next ? { ...next, result } : cur)),
      (e: Error) => setPeek((cur) => (cur === next ? { ...next, error: e.message } : cur)),
    )
  }
  const lookupRef = useRef(lookup)
  const problemsRef = useRef(p.problems.shown)
  const findingsRef = useRef(p.findingLines)
  useLayoutEffect(() => {
    lookupRef.current = lookup
    problemsRef.current = p.problems.shown
    findingsRef.current = p.findingLines
  })

  const options = useMemo<FileDiffOptions<Note, undefined>>(
    () => ({
      ...baseOptions,
      diffStyle: p.diffStyle,
      onLineSelectionEnd: (range) => {
        if (!range) return
        const side = (range.endSide ?? range.side ?? 'additions') as Side
        setDraft({ side, line: Math.min(range.start, range.end), endLine: Math.max(range.start, range.end) })
      },
      onPostRender: (node) => {
        markProblems(node.shadowRoot ?? node, problemsRef.current)
        markFindings(node.shadowRoot ?? node, findingsRef.current)
      },
      // ⌘/Ctrl-click a name jumps to its definition, like in an editor.
      onTokenClick: (t, e) => {
        if (!(e.metaKey || e.ctrlKey) || t.side === 'deletions' || !/^[A-Za-z_$][\w$]*$/.test(t.tokenText)) return
        e.preventDefault()
        lookupRef.current({ line: t.lineNumber, character: t.lineCharStart, name: t.tokenText, side: t.side }, false)
      },
    }),
    [p.diffStyle],
  )

  const annotations = useMemo(() => {
    const out: DiffLineAnnotation<Note>[] = p.problems.shown.map((x) => ({ side: 'additions', lineNumber: x.line, metadata: { kind: 'problem', id: x.id } }))
    out.push(...p.comments
      .filter((c) => c.line)
      .map((c): DiffLineAnnotation<Note> => ({ side: c.side ?? 'additions', lineNumber: c.endLine ?? c.line!, metadata: { kind: 'note', id: c.id } })))
    for (const t of p.threads) if (t.line && !t.outdated) out.push({ side: t.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: t.line, metadata: { kind: 'thread', id: t.id } })
    for (const t of p.aiThreads) out.push({ side: t.side, lineNumber: t.line, metadata: { kind: 'ai', id: t.id } })
    if (draft) out.push({ side: draft.side, lineNumber: draft.endLine, metadata: { kind: 'draft' } })
    if (peek) out.push({ side: peek.side, lineNumber: peek.line, metadata: { kind: 'peek' } })
    return out
  }, [p.problems, p.comments, p.threads, p.aiThreads, draft, peek])

  const suggestionSeed = draft && draft.side === 'additions' && p.patch ? newLines(p.patch.diff, draft.line, draft.endLine) : null
  const notes = p.comments.filter((c) => !c.line)
  const outdated = p.threads.filter((t) => !t.line || t.outdated)
  const warnings = p.checks.filter((c) => c.level === 'warn')
  const errors = p.problems.shown.filter((x) => x.severity === 'error').length
  const warningCount = p.problems.shown.length - errors
  const showBody = !p.collapsed && p.patch !== undefined
  const hovered = hover && p.aiThreads.find((t) => t.id === hover.id)
  const range = draft && `${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`

  const renderAnnotation = (a: DiffLineAnnotation<Note>) => {
    const meta = a.metadata
    if (!meta) return null
    const wrap = (node: React.ReactNode) => <div className="flex max-w-[860px] flex-col gap-1.5 py-2 pr-3 pl-16 font-sans">{node}</div>
    if (meta.kind === 'problem') {
      const x = p.problems.shown.find((y) => y.id === meta.id)
      return x ? <ProblemRow problem={x} className="my-0.5 ml-12 max-w-[900px]" /> : null
    }
    if (meta.kind === 'peek' && peek)
      return wrap(<CodePeek peek={peek} onJump={(f) => (setPeek(null), p.onJump(f))} onClose={() => setPeek(null)} />)
    if (meta.kind === 'ai') {
      const t = p.aiThreads.find((x) => x.id === meta.id)
      return t && p.agentName
        ? wrap(
            <AiThread
              thread={t}
              agentName={p.agentName}
              onFollowUp={(q) => p.onFollowUp(t.id, q)}
              onRetry={(m) => p.onRetry(t.id, m)}
              onToggle={(open) => {
                setHover(null)
                p.onToggleThread(t.id, open)
              }}
              onComment={(body) => setDraft({ side: t.side, line: t.line, endLine: t.line, body })}
              onHover={(rect) => {
                const box = sectionRef.current?.getBoundingClientRect()
                setHover(rect && box ? { id: t.id, left: Math.max(8, Math.min(rect.left - box.left, box.width - 520)), top: rect.bottom - box.top + 6 } : null)
              }}
            />,
          )
        : null
    }
    if (meta.kind === 'thread') {
      const t = p.threads.find((x) => x.id === meta.id)
      return t ? wrap(<ThreadCard thread={t} />) : null
    }
    if (meta.kind === 'draft' && draft)
      return wrap(
        <>
          {p.agentName && !draft.body && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start text-accent"
              onClick={() => {
                p.onAskAt({ file: p.path, side: draft.side, line: draft.endLine, about: `${fileName(p.path)}:${range}`, code: suggestionSeed ?? undefined }, 'What do these lines do, and is anything off?')
                setDraft(null)
              }}
            >
              Explain these lines with {p.agentName}
            </Button>
          )}
          <Composer
            key={draft.body ?? 'new'}
            kinds={p.kinds}
            initialBody={draft.body}
            placeholder={`Comment on line ${range}`}
            suggestionSeed={draft.body ? null : suggestionSeed}
            onCancel={() => setDraft(null)}
            onSave={(body: string, kind: CommentKind, suggestion?: string) => {
              p.onComment({ body, kind, suggestion, file: p.path, side: draft.side, line: draft.line, endLine: draft.endLine })
              setDraft(null)
            }}
          />
        </>,
      )
    const c = meta.kind === 'note' && p.comments.find((x) => x.id === meta.id)
    return c ? wrap(<CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />) : null
  }

  return (
    <section ref={sectionRef} data-file={p.path} className="relative mb-4 rounded-lg border border-line bg-canvas">
      <header
        className={cn(
          'sticky top-0 z-10 flex items-center gap-1.5 rounded-t-lg border-b border-line bg-surface px-2.5 py-1.5 text-sm',
          (p.collapsed || !showBody) && !notes.length && 'rounded-b-lg border-b-0',
          p.stuck && 'rounded-none shadow-float',
        )}
      >
        <button aria-label={p.collapsed ? 'Expand' : 'Collapse'} onClick={() => p.onCollapse(!p.collapsed)} className={cn('w-4 text-fg-subtle transition-transform', p.collapsed && '-rotate-90')}>
          ▾
        </button>
        {p.stuck && (
          <span className="max-w-[28%] shrink-0 truncate text-xs text-fg-subtle" title={p.chapterTitle}>
            {p.chapterTitle}
            <span className="mx-1.5 text-fg-faint">›</span>
          </span>
        )}
        <button onClick={() => p.onCollapse(!p.collapsed)} title={p.path} className="flex min-w-0 items-baseline font-mono text-xs">
          <span className="truncate text-fg-faint">{dirName(p.path)}/</span>
          <span className="shrink-0 font-semibold text-fg">{fileName(p.path)}</span>
        </button>
        {p.patch?.diff.type === 'new' && <Badge tone="success">new</Badge>}
        {p.patch?.diff.type === 'deleted' && <Badge tone="danger">deleted</Badge>}
        {p.owned && <Badge tone="accent">yours</Badge>}
        {errors > 0 && (
          <Badge tone="danger" title="Errors on lines this PR changed">
            ✕ {errors} {errors === 1 ? 'error' : 'errors'}
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge tone="warning" title="Warnings on lines this PR changed">
            ⚠ {warningCount}
          </Badge>
        )}
        {p.changedSinceViewed && <Badge tone="warning">changed since you viewed</Badge>}
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums">
          {p.patch && (
            <>
              <span className="text-success">+{p.patch.added}</span> <span className="text-danger">−{p.patch.removed}</span>
            </>
          )}
        </span>
        <LinkButton className="ml-2 shrink-0 text-xs" onClick={() => setFileNote(true)}>
          Comment
        </LinkButton>
        <label className={cn('ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs', p.viewed ? 'border-success/50 text-success' : 'border-line-strong text-fg-subtle')}>
          <input type="checkbox" checked={p.viewed} onChange={(e) => p.onViewed(e.target.checked)} className="accent-success" />
          Viewed
        </label>
      </header>

      {!p.collapsed && (p.usedBy.inside.length > 0 || p.usedBy.outsideCount > 0 || warnings.length > 0 || p.problems.other.length > 0) && (
        <div className="flex flex-col gap-1 border-b border-line bg-surface/40 px-3 py-1.5 text-xs">
          {p.usedBy.inside.slice(0, 4).map((u) => (
            <div key={u.name} className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono text-fg">{u.name}</code>
              <span className="text-fg-faint">used by</span>
              {u.files.slice(0, 5).map((f) => (
                <button key={f} title={f} onClick={() => p.onJump(f)} className="inline-flex items-baseline gap-1 rounded-sm border border-line-strong px-1.5 text-fg-muted hover:border-accent hover:text-fg">
                  {stem(f)}
                  <span className="text-2xs text-accent">↓ in this PR</span>
                </button>
              ))}
              {u.files.length > 5 && <span className="text-fg-faint">+{u.files.length - 5} more</span>}
            </div>
          ))}
          {p.usedBy.inside.length > 4 && <p className="text-fg-faint">{p.usedBy.inside.length - 4} more changed names are used elsewhere in this PR</p>}
          {p.usedBy.outsideCount > 0 && (
            <p title={p.usedBy.outside.join('\n')} className="cursor-help text-fg-subtle">
              Used outside this PR in {p.usedBy.outsideCount} {p.usedBy.outsideCount === 1 ? 'file' : 'files'}
              {p.usedBy.outside.length > 0 && <span className="text-fg-faint">: {p.usedBy.outside.slice(0, 4).join(', ')}</span>}
            </p>
          )}
          {p.problems.other.length > 0 && (
            <p
              title={p.problems.other.map((x) => `${x.line}: ${x.message.split('\n')[0]}`).join('\n')}
              className="cursor-help text-fg-faint"
            >
              {p.problems.other.length} more {p.problems.other.length === 1 ? 'problem' : 'problems'} in lines this PR didn't change
            </p>
          )}
          {warnings.map((w) => (
            <p key={w.text} className="text-warning">
              {w.text}
            </p>
          ))}
        </div>
      )}

      {(fileNote || notes.length > 0 || outdated.length > 0) && !p.collapsed && (
        <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2 font-sans">
          {outdated.map((t) => (
            <ThreadCard key={t.id} thread={t} />
          ))}
          {notes.map((c) => (
            <CommentCard key={c.id} c={c} onDelete={() => p.onDeleteComment(c.id)} />
          ))}
          {fileNote && (
            <Composer
              kinds={p.kinds}
              placeholder={`Comment on ${fileName(p.path)}`}
              suggestionSeed={null}
              onCancel={() => setFileNote(false)}
              onSave={(body: string, kind: CommentKind) => {
                p.onComment({ body, kind, file: p.path })
                setFileNote(false)
              }}
            />
          )}
        </div>
      )}

      {p.collapsed && !p.viewed && (
        <p className="px-3 py-2 text-xs text-fg-faint">
          {p.test ? 'Test file' : 'Collapsed'}
          {p.patch && `, ${p.patch.added + p.patch.removed} lines`} · <LinkButton onClick={() => p.onCollapse(false)}>Show diff</LinkButton>
        </p>
      )}
      {showBody &&
        (p.patch ? (
          <FileDiff<Note, undefined>
            className="block overflow-hidden rounded-b-lg"
            fileDiff={p.patch.diff}
            options={options}
            lineAnnotations={annotations}
            selectedLines={draft ? { start: draft.line, end: draft.endLine, side: draft.side } : null}
            renderAnnotation={renderAnnotation}
          />
        ) : (
          <p className="px-3 py-2 text-xs text-fg-faint">Renamed or moved, no lines changed.</p>
        ))}
      {hovered && p.agentName && (
        <div role="tooltip" style={{ left: hover!.left, top: hover!.top }} className="pointer-events-none absolute z-20 w-[min(500px,90%)] rounded-lg border border-accent/50 bg-surface font-sans shadow-overlay">
          <ThreadMessages thread={hovered} agentName={p.agentName} />
        </div>
      )}
    </section>
  )
}
