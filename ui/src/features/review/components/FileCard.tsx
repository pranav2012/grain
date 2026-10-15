import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiffLineAnnotation, FileDiffLoadedFiles, FileDiffMetadata, FileDiffOptions } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import { Badge } from '@/components/ui/Badge'
import { Button, LinkButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { ago } from '@/lib/format'
import type { Check } from '@/types/generated/Check'
import type { Finding } from '@/types/generated/Finding'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import type { FilePatch } from '../hooks/usePrDiff'
import type { UsedBy } from '../model/files'
import type { FileProblems } from '../model/problems'
import type { OutsideUsesResponse } from '@/types/generated/OutsideUsesResponse'
import { markFindings, markProblems, squiggleCSS } from '../model/squiggles'
import { newLines } from '../model/suggestion'
import type { CommentKind, DiffStyle, LastChange, LineThread, ReviewComment, Side } from '../model/types'
import { AiThread, ThreadMessages } from './AiThread'
import type { CodeLocation } from './CodeModal'
import { CodePeek, type Peek } from './CodePeek'
import { HoverRefs, type HoverState } from './HoverRefs'
import { CommentCard } from './CommentCard'
import { FindingNote } from './FindingNote'
import { Composer } from './Composer'
import { ProblemRow } from './ProblemRow'
import { ThreadCard } from './ThreadCard'

type Note = { kind: 'draft' } | { kind: 'peek' } | { kind: 'finding'; key: string } | { kind: 'ai'; id: string } | { kind: 'note'; id: string } | { kind: 'thread'; id: string } | { kind: 'problem'; id: string }
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
  /** Who last changed this file before the PR. */
  lastChange?: LastChange
  diffStyle: DiffStyle
  usedBy: UsedBy
  checks: Check[]
  comments: ReviewComment[]
  threads: ReviewThread[]
  aiThreads: LineThread[]
  problems: FileProblems
  /** Lines the agent's second opinion comments on. */
  findingLines: number[]
  /** The agent's findings in this file still waiting for the reviewer's call, by `findingKey`. */
  findings: [string, Finding][]
  /** A draft (its id) or finding (`ai:` + key) open for editing, on any file. */
  editing: string | null
  onEditing(id: string | null): void
  onEditComment(id: string, body: string, kind: CommentKind, suggestion?: string): void
  onKeepFinding(f: Finding, edited?: { body: string; kind: CommentKind; suggestion?: string }): void
  onDismissFinding(f: Finding): void
  agentName: string | null
  kinds: [CommentKind, string][]
  onCollapse(collapsed: boolean): void
  onViewed(viewed: boolean): void
  onJump(path: string, line?: number): void
  /** Opens a whole file at a line, or at the first use of a name. */
  onOpenCode(loc: CodeLocation): void
  /** Where outside code uses this file's changes (loaded on request). */
  /** Where code outside the PR uses this file's changes; undefined while still being worked out. */
  outsideUses?: OutsideUsesResponse | null
  /** Both versions of the file, so the diff can show unchanged lines. */
  loadFiles(diff: FileDiffMetadata): Promise<FileDiffLoadedFiles>
  inPr(file: string): boolean
  /** A line on GitHub, for code outside this PR; none for local reviews. */
  githubUrl?: (file: string, line: number) => string
  onLookup(token: { line: number; character: number; name: string; oldSide?: boolean }, references: boolean): Promise<Peek['result']>
  onComment(c: NewComment): void
  onDeleteComment(id: string): void
  onAskAt(anchor: ThreadAnchor, question: string): void
  onFollowUp(threadId: string, question: string): void
  onRetry(threadId: string, messageId: string): void
  onToggleThread(threadId: string, open: boolean): void
}

/** Hidden-lines bars styled like GitHub's: a blue band with blue expand arrows that fill on hover. */
const hunkBarCSS = `[data-separator], [data-separator-wrapper], [data-separator-content] { background-color: color-mix(in srgb, var(--color-accent) 10%, var(--color-canvas)) !important; color: var(--color-fg-subtle) !important; }
[data-expand-button] { background-color: color-mix(in srgb, var(--color-accent) 18%, var(--color-canvas)) !important; color: var(--color-accent) !important; border-right-color: transparent !important; }
[data-expand-button]:hover { background-color: var(--color-accent) !important; color: var(--color-canvas) !important; }`

const baseOptions: FileDiffOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  disableFileHeader: true,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  hunkSeparators: 'line-info',
  // Like GitHub: each click on a hidden-lines bar shows 20 more lines.
  expansionLineCount: 20,
  lineDiffType: 'word-alt',
  unsafeCSS: `* { --diffs-dark-bg: var(--color-canvas) !important; }\n${hunkBarCSS}\n${squiggleCSS}`,
}

const fileName = (p: string) => p.split('/').pop()!
const dirName = (p: string) => p.split('/').slice(0, -1).join('/')
const stem = (p: string) => fileName(p).replace(/\.[^.]+$/, '')

/** Touch screens: no hover, so a plain tap on a name looks it up instead of ⌘-click. */
const touch = () => matchMedia('(hover: none)').matches

const KEYWORDS = new Set(
  'import export from default as const let var function return if else for while do switch case break continue new this typeof instanceof in of async await class extends interface type enum true false null undefined void try catch finally throw yield static public private protected readonly implements declare namespace keyof satisfies'.split(' '),
)

/** One changed file on the review page: a pinned header, who uses it, then its whole diff with notes under lines. */
export function FileCard(p: FileCardProps) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fileNote, setFileNote] = useState(false)
  const [peek, setPeek] = useState<Peek | null>(null)
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [refHover, setRefHover] = useState<HoverState | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoverCache = useRef(new Map<string, Promise<[Peek['result'], Peek['result']]>>())

  const lookup = (t: { line: number; character: number; name: string; side: Side }, references: boolean) => {
    const next: Peek = { itemId: p.path, line: t.line, side: t.side, name: t.name, references, character: t.character }
    setPeek(next)
    p.onLookup({ ...t, oldSide: t.side === 'deletions' }, references).then(
      (result) => setPeek((cur) => (cur === next ? { ...next, result } : cur)),
      (e: Error) => setPeek((cur) => (cur === next ? { ...next, error: e.message } : cur)),
    )
  }
  // After resting on a name for half a second, show where it's defined and used.
  const hoverName = (t: { lineNumber: number; lineCharStart: number; tokenText: string; side: Side; tokenElement: HTMLElement }) => {
    clearTimeout(hoverTimer.current)
    if (touch() || !/^[A-Za-z_$][\w$]*$/.test(t.tokenText) || t.tokenText.length < 2 || KEYWORDS.has(t.tokenText)) return
    hoverTimer.current = setTimeout(() => {
      const rect = t.tokenElement.getBoundingClientRect()
      const base: HoverState = { name: t.tokenText, token: { line: t.lineNumber, character: t.lineCharStart, side: t.side }, left: rect.left, top: rect.bottom + 6 }
      setRefHover(base)
      const key = `${t.side}:${t.lineNumber}:${t.lineCharStart}`
      let found = hoverCache.current.get(key)
      if (!found) {
        const token = { line: t.lineNumber, character: t.lineCharStart, name: t.tokenText, oldSide: t.side === 'deletions' }
        found = Promise.all([p.onLookup(token, false), p.onLookup(token, true)])
        found.catch(() => hoverCache.current.delete(key))
        hoverCache.current.set(key, found)
      }
      found.then(
        ([definition, references]) => setRefHover((h) => (h?.name === base.name && h.left === base.left ? { ...h, definition, references } : h)),
        (e: Error) => setRefHover((h) => (h?.name === base.name ? { ...h, error: e.message } : h)),
      )
    }, 500)
  }
  const leaveName = () => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setRefHover(null), 250)
  }
  const lookupRef = useRef(lookup)
  const problemsRef = useRef(p.problems.shown)
  const findingsRef = useRef(p.findingLines)
  const hoverRef = useRef({ hoverName, leaveName, loadFiles: p.loadFiles })
  useLayoutEffect(() => {
    lookupRef.current = lookup
    problemsRef.current = p.problems.shown
    findingsRef.current = p.findingLines
    hoverRef.current = { hoverName, leaveName, loadFiles: p.loadFiles }
  })

  const options = useMemo<FileDiffOptions<Note, undefined>>(
    () => ({
      ...baseOptions,
      diffStyle: p.diffStyle,
      loadDiffFiles: (diff) => hoverRef.current.loadFiles(diff),
      onTokenEnter: (t) => hoverRef.current.hoverName(t),
      onTokenLeave: () => hoverRef.current.leaveName(),
      onLineSelectionEnd: (range) => {
        if (!range) return
        const side = (range.endSide ?? range.side ?? 'additions') as Side
        setDraft({ side, line: Math.min(range.start, range.end), endLine: Math.max(range.start, range.end) })
      },
      onPostRender: (node) => {
        markProblems(node.shadowRoot ?? node, problemsRef.current)
        markFindings(node.shadowRoot ?? node, findingsRef.current)
      },
      // ⌘/Ctrl-click a name shows its definition, like in an editor; with Shift, its references. On touch, a tap does.
      onTokenClick: (t, e) => {
        if (!(e.metaKey || e.ctrlKey || touch()) || !/^[A-Za-z_$][\w$]*$/.test(t.tokenText) || KEYWORDS.has(t.tokenText)) return
        e.preventDefault()
        lookupRef.current({ line: t.lineNumber, character: t.lineCharStart, name: t.tokenText, side: t.side }, e.shiftKey)
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
    for (const [key, f] of p.findings) out.push({ side: 'additions', lineNumber: f.endLine || f.line, metadata: { kind: 'finding', key } })
    if (draft) out.push({ side: draft.side, lineNumber: draft.endLine, metadata: { kind: 'draft' } })
    if (peek) out.push({ side: peek.side, lineNumber: peek.line, metadata: { kind: 'peek' } })
    return out
  }, [p.problems, p.comments, p.threads, p.aiThreads, p.findings, draft, peek])

  const suggestionSeed = draft && draft.side === 'additions' && p.patch ? newLines(p.patch.diff, draft.line, draft.endLine) : null
  const notes = p.comments.filter((c) => !c.line)
  const outdated = p.threads.filter((t) => !t.line || t.outdated)
  // The engine's "used outside this PR" note counts a whole group of files; the exact list below replaces it.
  const warnings = p.checks.filter((c) => c.level === 'warn' && !c.text.startsWith('Changed code is used in'))
  const outside = p.outsideUses?.uses ?? []
  const errors = p.problems.shown.filter((x) => x.severity === 'error').length
  const warningCount = p.problems.shown.length - errors
  const showBody = !p.collapsed && p.patch !== undefined
  const hovered = hover && p.aiThreads.find((t) => t.id === hover.id)
  const range = draft && `${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`

  const editor = (c: ReviewComment) => (
    <Composer
      kinds={p.kinds}
      initialKind={c.kind}
      initialBody={c.body}
      initialSuggestion={c.suggestion}
      suggestionSeed={c.side !== 'deletions' && c.line && p.patch ? newLines(p.patch.diff, c.line, c.endLine ?? c.line) : null}
      onCancel={() => p.onEditing(null)}
      onSave={(body: string, kind: CommentKind, suggestion?: string) => {
        p.onEditComment(c.id, body, kind, suggestion)
        p.onEditing(null)
      }}
    />
  )
  const draftCard = (c: ReviewComment) => (p.editing === c.id ? editor(c) : <CommentCard c={c} onEdit={() => p.onEditing(c.id)} onDelete={() => p.onDeleteComment(c.id)} />)

  const renderAnnotation = (a: DiffLineAnnotation<Note>) => {
    const meta = a.metadata
    if (!meta) return null
    const wrap = (node: React.ReactNode) => <div className="flex max-w-[860px] min-w-0 flex-col gap-1.5 py-2 pr-3 pl-[clamp(0.75rem,8%,4rem)] font-sans">{node}</div>
    if (meta.kind === 'problem') {
      const x = p.problems.shown.find((y) => y.id === meta.id)
      return x ? <ProblemRow problem={x} className="my-0.5 ml-[clamp(0.5rem,6%,3rem)] max-w-[900px]" /> : null
    }
    if (meta.kind === 'peek' && peek)
      return wrap(
        <CodePeek
          peek={peek}
          githubUrl={p.githubUrl}
          onJump={(f, line) => (setPeek(null), p.onJump(f, line))}
          onSwitch={(references) => lookup({ line: peek.line, character: peek.character, name: peek.name, side: peek.side }, references)}
          onOpen={(file, line) => p.onOpenCode({ file, line })}
          onClose={() => setPeek(null)}
        />,
      )
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
                setHover(rect && box ? { id: t.id, left: Math.max(8, Math.min(rect.left - box.left, box.width - Math.min(500, box.width * 0.9) - 8)), top: rect.bottom - box.top + 6 } : null)
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
    if (meta.kind === 'finding') {
      const f = p.findings.find(([k]) => k === meta.key)?.[1]
      if (!f) return null
      if (p.editing === `ai:${meta.key}`)
        return wrap(
          <Composer
            kinds={p.kinds}
            initialBody={f.comment}
            placeholder="Edit the AI's comment; saving makes it your draft"
            suggestionSeed={p.patch ? newLines(p.patch.diff, f.line, f.endLine || f.line) : null}
            onCancel={() => p.onEditing(null)}
            onSave={(body: string, kind: CommentKind, suggestion?: string) => {
              p.onKeepFinding(f, { body, kind, suggestion })
              p.onEditing(null)
            }}
          />,
        )
      return wrap(<FindingNote finding={f} onKeep={() => p.onKeepFinding(f)} onEdit={() => p.onEditing(`ai:${meta.key}`)} onDismiss={() => p.onDismissFinding(f)} />)
    }
    return c ? wrap(draftCard(c)) : null
  }

  return (
    <section
      ref={sectionRef}
      data-file={p.path}
      className="relative mb-4 rounded-lg border border-line bg-canvas"
    >
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
          <span className="max-w-[28%] shrink-0 truncate text-xs text-fg-subtle max-md:hidden" title={p.chapterTitle}>
            {p.chapterTitle}
            <span className="mx-1.5 text-fg-faint">›</span>
          </span>
        )}
        <button onClick={() => p.onCollapse(!p.collapsed)} title={p.path} className="flex min-w-0 items-baseline font-mono text-xs">
          <span className="truncate text-fg-faint max-sm:hidden">{dirName(p.path)}/</span>
          <span className="min-w-0 shrink-0 font-semibold text-fg max-sm:shrink max-sm:truncate">{fileName(p.path)}</span>
        </button>
        {p.patch?.diff.type === 'new' && <Badge tone="success">new</Badge>}
        {p.patch?.diff.type === 'deleted' && <Badge tone="danger">deleted</Badge>}
        {p.lastChange && (
          <span
            className="min-w-0 shrink truncate text-xs text-fg-faint max-[1100px]:hidden"
            title={`Last change before this PR: ${p.lastChange.sha.slice(0, 7)} ${p.lastChange.subject} (${p.lastChange.author}, ${new Date(p.lastChange.at * 1000).toLocaleDateString()})`}
          >
            last: {p.lastChange.author} · {ago(new Date(p.lastChange.at * 1000).toISOString())}
          </span>
        )}
        {errors > 0 && (
          <Badge tone="danger" title="Errors on lines this PR changed">
            ✕ {errors}<span className="max-sm:hidden"> {errors === 1 ? 'error' : 'errors'}</span>
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge tone="warning" title="Warnings on lines this PR changed">
            ⚠ {warningCount}
          </Badge>
        )}
        {p.changedSinceViewed && <Badge tone="warning" title="Changed since you viewed">changed<span className="max-sm:hidden"> since you viewed</span></Badge>}
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums">
          {p.patch && (
            <>
              <span className="text-success">+{p.patch.added}</span> <span className="text-danger">−{p.patch.removed}</span>
            </>
          )}
        </span>
        <LinkButton className="ml-2 shrink-0 text-xs max-sm:ml-1" onClick={() => setFileNote(true)}>
          Comment
        </LinkButton>
        <label className={cn('ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs max-sm:ml-1 max-sm:px-1.5', p.viewed ? 'border-success/50 text-success' : 'border-line-strong text-fg-subtle')}>
          <input type="checkbox" checked={p.viewed} onChange={(e) => p.onViewed(e.target.checked)} className="accent-success" />
          Viewed
        </label>
      </header>

      {!p.collapsed && (p.usedBy.inside.length > 0 || outside.length > 0 || p.outsideUses === undefined || warnings.length > 0 || p.problems.other.length > 0) && (
        <div className="flex flex-col gap-1 border-b border-line bg-surface/40 px-3 py-1.5 text-xs">
          {p.usedBy.inside.slice(0, 4).map((u) => (
            <div key={u.name} className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono text-fg">{u.name}</code>
              <span className="text-fg-faint">used by</span>
              {u.files.slice(0, 5).map((f) => (
                <button key={f} title={`Open ${f} where it uses ${u.name}`} onClick={() => p.onOpenCode({ file: f, find: u.name })} className="inline-flex items-baseline gap-1 rounded-sm border border-line-strong px-1.5 text-fg-muted hover:border-accent hover:text-fg">
                  {stem(f)}
                  <span className="text-2xs text-accent">in this PR</span>
                </button>
              ))}
              {u.files.length > 5 && <span className="text-fg-faint">+{u.files.length - 5} more</span>}
            </div>
          ))}
          {p.usedBy.inside.length > 4 && <p className="text-fg-faint">{p.usedBy.inside.length - 4} more changed names are used elsewhere in this PR</p>}
          {p.outsideUses === undefined && <p className="text-fg-faint">Finding uses outside this PR…</p>}
          {outside.length > 0 && p.outsideUses && <OutsideUses found={p.outsideUses} githubUrl={p.githubUrl} onOpen={p.onOpenCode} />}
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
            <div key={c.id}>{draftCard(c)}</div>
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
      {refHover && (
        <HoverRefs
          hover={refHover}
          inPr={p.inPr}
          onOpen={(loc) => (setRefHover(null), p.onOpenCode(loc))}
          onAllReferences={() => {
            setRefHover(null)
            lookup({ ...refHover.token, name: refHover.name }, true)
          }}
          onEnter={() => clearTimeout(hoverTimer.current)}
          onLeave={leaveName}
        />
      )}
    </section>
  )
}

/** Every place outside the PR that uses this file's changed names; one click opens the whole file there. */
function OutsideUses({ found, githubUrl, onOpen }: { found: OutsideUsesResponse; githubUrl?: (file: string, line: number) => string; onOpen(loc: CodeLocation): void }) {
  const [all, setAll] = useState(false)
  const rows = found.uses.flatMap((u) => u.locations.map((l) => ({ name: u.name, l })))
  const files = new Set(rows.map((r) => r.l.file)).size
  const shown = all ? rows : rows.slice(0, 5)
  return (
    <div>
      <p className="text-warning">
        Used outside this PR in {rows.length} {rows.length === 1 ? 'place' : 'places'}
        {files > 1 && ` across ${files} files`}
        {!found.precise && <span className="text-fg-faint"> · found by name, may include unrelated matches</span>}
      </p>
      <ul className="mt-0.5 flex flex-col">
        {shown.map(({ name, l }) => (
          <li key={`${l.file}:${l.line}:${name}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
            <button onClick={() => onOpen({ file: l.file, line: l.line })} title={`Open ${l.file} at line ${l.line}`} className="grid min-w-0 grid-cols-[minmax(0,16rem)_minmax(0,1fr)] gap-3 rounded-sm px-1 text-left font-mono hover:bg-raised">
              <span className="truncate text-fg-muted">
                {fileName(l.file)}:{l.line}
              </span>
              <span className="truncate text-fg-subtle">{(l.snippet[l.line - l.snippetStart] ?? '').trim()}</span>
            </button>
            {githubUrl && (
              <a href={githubUrl(l.file, l.line)} target="_blank" rel="noreferrer" className="text-fg-faint hover:text-fg">
                GitHub ↗
              </a>
            )}
          </li>
        ))}
      </ul>
      {rows.length > 5 && (
        <LinkButton className="mt-0.5 text-xs" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </LinkButton>
      )}
    </div>
  )
}
