import { useMemo, useRef, useState } from 'react'
import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import { CodeView, type CodeViewReactOptions } from '@pierre/diffs/react'
import { Button } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { Segmented } from '@/components/ui/Segmented'
import { shortPath } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import type { Chapter } from '@/types/generated/Chapter'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { reviewApi } from '../api'
import { useStepDiff } from '../hooks/useStepDiff'
import { blockTitle, chapterSummaryOf } from '../model/describe'
import { modes } from '../model/modes'
import { chapterHighlights, kindLabel } from '../model/story'
import { newLines } from '../model/suggestion'
import type { Ask, BlockState, CommentKind, DiffStyle, LineThread, LoadedPr, Mode, ReviewComment, Side } from '../model/types'
import { AiThread, ThreadMessages } from './AiThread'
import { BlockCard } from './BlockCard'
import { CodePeek, type Peek } from './CodePeek'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ThreadCard } from './ThreadCard'

type Note = { kind: 'draft' } | { kind: 'peek' } | { kind: 'ai'; id: string } | { kind: 'note'; id: string } | { kind: 'thread'; id: string }
type NewComment = Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>

interface Draft {
  file: string
  side: Side
  line: number
  endLine: number
  /** Prefilled text, e.g. an agent's answer turned into a comment. */
  body?: string
}

/** A name in the diff, for right-click and ⌘-click. */
interface Token {
  file: string
  line: number
  character: number
  name: string
  side: Side
  lineText: string
}

/** Where a line thread goes: the file, line and what it's about. */
export type ThreadAnchor = Pick<LineThread, 'file' | 'side' | 'line' | 'about' | 'code'>

interface ChangeViewProps {
  data: LoadedPr
  chapter: Chapter
  section: string
  /** This change's place in the chapter, from 1. */
  index: number
  count: number
  block: Block
  prev?: Block
  next?: Block
  /** The next chapter, when this is the chapter's last change. */
  nextChapter?: Chapter
  mode: Mode
  diffStyle: DiffStyle
  state?: BlockState
  stale: boolean
  owned: boolean
  comments: ReviewComment[]
  threads: ReviewThread[]
  agentName: string | null
  summaryPending: boolean
  composeTick: number
  asks: Ask[]
  aiThreads: LineThread[]
  onAsk(question: string): void
  onAskAt(anchor: ThreadAnchor, question: string): void
  onFollowUp(threadId: string, question: string): void
  onRetry(threadId: string, messageId: string): void
  onToggleThread(threadId: string, open: boolean): void
  onMark(state: BlockState | null): void
  onExplain(): void
  onApproveAll(): void
  onDiffStyle(style: DiffStyle): void
  onStep(d: number): void
  onGo(blockId: number): void
  /** Marks this change reviewed and moves on. */
  onPrimary(): void
  onComment(c: NewComment): void
  onDeleteComment(id: string): void
}

const baseOptions: CodeViewReactOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  stickyHeaders: false,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  layout: { paddingTop: 0, paddingBottom: 16, gap: 8 },
  unsafeCSS: '* { --diffs-dark-bg: var(--color-canvas) !important; }',
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0)

/**
 * The name under a pointer event, read from the diff's DOM: the text span, its line row
 * (`data-line`) and the file's header (`data-file`). The viewer renders in a shadow root, so this
 * walks the composed path.
 */
function tokenAt(e: React.MouseEvent): Token | null {
  const path = e.nativeEvent.composedPath().filter((n): n is HTMLElement => n instanceof HTMLElement)
  const span = path[0]
  const name = span?.textContent?.trim() ?? ''
  if (!span || span.children.length || !/^[A-Za-z_$][\w$]*$/.test(name)) return null
  const row = path.find((el) => el.dataset.line !== undefined && el.dataset.lineType !== undefined)
  const host = path.find((el) => el.tagName === 'DIFFS-CONTAINER')
  const file = host?.querySelector('[data-file]')?.getAttribute('data-file')
  if (!row || !file) return null
  let character = 0
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n && !span.contains(n); n = walker.nextNode()) character += n.textContent?.length ?? 0
  character += (span.textContent?.length ?? 0) - (span.textContent?.trimStart().length ?? 0)
  const side: Side = row.dataset.lineType!.includes('deletion') ? 'deletions' : 'additions'
  return { file, line: Number(row.dataset.line), character, name, side, lineText: row.textContent ?? '' }
}

/** One change on its own page: where it sits in its flow, its card, its files, then Previous and Next. */
export function ChangeView(p: ChangeViewProps) {
  const { data, chapter, block } = p
  const copy = modes[p.mode]
  const blocks = useMemo(() => [block], [block])
  const nextFiles = useMemo(() => p.next?.files, [p.next])
  const { parts, error } = useStepDiff(data.id, data.pr?.headSha ?? '', blocks, undefined, nextFiles)
  const diffs = useMemo(() => parts?.[0]?.diffs ?? [], [parts])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [peek, setPeek] = useState<Peek | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; token: Token } | null>(null)
  const [hover, setHover] = useState<{ id: string; left: number; top: number } | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const options = useMemo(() => ({ ...baseOptions, diffStyle: p.diffStyle }), [p.diffStyle])
  const intro = chapterSummaryOf(data, chapter)

  const lookup = (token: Token, references: boolean) => {
    const next: Peek = { itemId: token.file, line: token.line, side: token.side, name: token.name, references }
    setPeek(next)
    reviewApi.navigate(data.id, { file: token.file, line: token.line, character: token.character, name: token.name, references }).then(
      (result) => setPeek((cur) => (cur === next ? { ...next, result } : cur)),
      (e: Error) => setPeek((cur) => (cur === next ? { ...next, error: e.message } : cur)),
    )
  }

  const items = useMemo<CodeViewItem<Note>[]>(
    () =>
      diffs.map((fileDiff) => {
        const file = fileDiff.name
        const annotations: DiffLineAnnotation<Note>[] = p.comments
          .filter((c) => c.file === file && c.line)
          .map((c) => ({ side: c.side ?? 'additions', lineNumber: c.endLine ?? c.line!, metadata: { kind: 'note', id: c.id } }))
        for (const t of p.threads)
          if (t.path === file && t.line && !t.outdated) annotations.push({ side: t.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: t.line, metadata: { kind: 'thread', id: t.id } })
        for (const t of p.aiThreads) if (t.file === file) annotations.push({ side: t.side, lineNumber: t.line, metadata: { kind: 'ai', id: t.id } })
        if (draft?.file === file) annotations.push({ side: draft.side, lineNumber: draft.endLine, metadata: { kind: 'draft' } })
        if (peek?.itemId === file) annotations.push({ side: peek.side, lineNumber: peek.line, metadata: { kind: 'peek' } })
        // The viewer re-renders an item only when its version changes.
        const shown = [annotations.length, draft && [draft.line, draft.endLine, draft.body], peek?.itemId === file && [peek.line, peek.references, !!peek.result, !!peek.error], p.aiThreads.map((t) => [t.open, t.messages.map((m) => !!(m.answer ?? m.error))])]
        return { id: file, type: 'diff', fileDiff, annotations, version: hash(JSON.stringify(shown)) }
      }),
    [diffs, p.comments, p.threads, p.aiThreads, draft, peek],
  )

  const draftDiff = draft && diffs.find((d) => d.name === draft.file)
  const suggestionSeed = draft && draft.side === 'additions' && draftDiff ? newLines(draftDiff, draft.line, draft.endLine) : null

  const onContextMenu = (e: React.MouseEvent) => {
    const t = tokenAt(e)
    if (!t) return
    e.preventDefault()
    const box = mainRef.current!.getBoundingClientRect()
    setMenu({ x: Math.min(e.clientX - box.left, box.width - 240), y: e.clientY - box.top, token: t })
  }
  // ⌘/Ctrl-click jumps straight to the definition, like in an editor.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return
    const t = tokenAt(e)
    if (!t || t.side === 'deletions') return
    e.preventDefault()
    e.stopPropagation()
    lookup(t, false)
  }

  const header = (
    <header className="px-4 pt-3 font-sans">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-fg-subtle">
        <span>{kindLabel[chapter.kind]}</span>
        <span className="font-medium break-all text-fg-muted">{chapter.title}</span>
        {p.section && (
          <>
            <span aria-hidden>›</span>
            <span>{p.section}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>
          change {p.index} of {p.count}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Segmented
            label="Diff layout"
            size="sm"
            value={p.diffStyle}
            onChange={p.onDiffStyle}
            options={[
              ['unified', 'Unified'],
              ['split', 'Side by side'],
            ]}
          />
          <Kbd>s</Kbd>
        </div>
      </div>
      {p.index === 1 && (
        <div className="mt-1.5 max-w-[90ch] px-2 text-sm leading-relaxed text-fg-subtle">
          {intro ? <InlineCode text={intro.intent} /> : `${chapter.about}. Touches ${chapterHighlights(data, chapter)}.`}
          {chapter.kind === 'routine' && (
            <Button size="sm" variant="primary" className="ml-3" onClick={p.onApproveAll}>
              ✓ Approve all routine changes
            </Button>
          )}
        </div>
      )}
      <BlockCard
        data={data}
        block={block}
        mode={p.mode}
        current
        state={p.state}
        stale={p.stale}
        owned={p.owned}
        notes={p.comments.filter((c) => !c.line)}
        outdated={p.threads.filter((t) => !t.line || t.outdated)}
        agentName={p.agentName}
        summaryPending={p.summaryPending}
        composeTick={p.composeTick}
        asks={p.asks}
        onAsk={p.onAsk}
        onFocus={() => {}}
        onMark={p.onMark}
        onExplain={p.onExplain}
        onComment={p.onComment}
        onDeleteComment={p.onDeleteComment}
      />
    </header>
  )

  const nextLabel = p.next ? blockTitle(data, p.next) : p.nextChapter ? `Next flow: ${p.nextChapter.title}` : null
  const footer = (
    <nav aria-label="Changes" className="mx-4 mt-4 mb-10 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 font-sans">
      <Button size="sm" variant="ghost" onClick={() => p.onStep(-1)}>
        ← Previous <Kbd>k</Kbd>
      </Button>
      <span className="min-w-0 flex-1 truncate text-center text-xs text-fg-faint">{nextLabel && `Next: ${nextLabel}`}</span>
      {p.state !== 'ok' && (
        <Button size="sm" variant="primary" onClick={p.onPrimary}>
          ✓ {copy.primary} and next <Kbd>space</Kbd>
        </Button>
      )}
      <Button size="sm" onClick={() => p.onStep(1)} disabled={!nextLabel}>
        Next <Kbd>j</Kbd>
      </Button>
    </nav>
  )

  const hovered = hover && p.aiThreads.find((t) => t.id === hover.id)
  const showHover = (id: string, rect: DOMRect | null) => {
    const box = mainRef.current?.getBoundingClientRect()
    setHover(rect && box ? { id, left: Math.max(8, Math.min(rect.left - box.left, box.width - 520)), top: rect.bottom - box.top + 6 } : null)
  }

  return (
    <main ref={mainRef} onContextMenu={onContextMenu} onClickCapture={onClickCapture} className="relative flex min-h-0 min-w-0 flex-col [grid-area:main]">
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onMouseDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} />
          <div role="menu" style={{ left: menu.x, top: menu.y }} className="absolute z-20 min-w-56 rounded-lg border border-line-strong bg-raised p-1 font-sans shadow-overlay">
            {menu.token.side === 'deletions' ? (
              <p className="px-2.5 py-1.5 text-sm text-fg-subtle">Navigation works on the new version of the code.</p>
            ) : (
              <>
                <MenuItem label="Go to definition" hint="⌘ click" onClick={() => (lookup(menu.token, false), setMenu(null))} />
                <MenuItem label="Find references" onClick={() => (lookup(menu.token, true), setMenu(null))} />
              </>
            )}
            {p.agentName && (
              <MenuItem
                label={`Explain ${menu.token.name}`}
                hint="AI"
                onClick={() => {
                  const t = menu.token
                  p.onAskAt({ file: t.file, side: t.side, line: t.line, about: t.name, code: t.lineText.trim() }, `What is \`${t.name}\` here and what does it do?`)
                  setMenu(null)
                }}
              />
            )}
          </div>
        </>
      )}
      {hovered && p.agentName && (
        <div
          role="tooltip"
          style={{ left: hover.left, top: hover.top }}
          className="pointer-events-none absolute z-20 w-[min(500px,90%)] rounded-lg border border-accent/50 bg-surface font-sans shadow-overlay"
        >
          <ThreadMessages thread={hovered} agentName={p.agentName} />
        </div>
      )}
      {!parts ? (
        <>
          {header}
          <div className="m-auto text-fg-subtle">{error ?? 'Loading the diff…'}</div>
        </>
      ) : (
        <CodeView<Note, undefined>
          key={`${block.id}-${p.diffStyle}`}
          className="min-h-0 flex-1 overflow-auto bg-canvas"
          items={items}
          options={options}
          renderCodeViewHeader={() => header}
          renderCodeViewFooter={() => (
            <>
              {items.length === 0 && <p className="mx-6 mt-4 text-fg-subtle">This change only renames or moves files; there are no lines to show.</p>}
              {footer}
            </>
          )}
          renderCustomHeader={(item) => {
            const fileDiff = item.type === 'diff' ? item.fileDiff : null
            const added = fileDiff?.hunks.reduce((n, h) => n + h.additionLines, 0) ?? 0
            const removed = fileDiff?.hunks.reduce((n, h) => n + h.deletionLines, 0) ?? 0
            return (
              <div data-file={item.id} className="mx-4 flex items-center justify-between rounded-t-md border border-b-0 border-line bg-surface px-3 py-1.5 font-mono text-xs text-fg-muted">
                <span className="truncate" title={item.id}>
                  {shortPath(item.id)}
                </span>
                <span className="shrink-0 pl-3">
                  <span className="text-danger">−{removed}</span> <span className="text-success">+{added}</span>
                </span>
              </div>
            )
          }}
          selectedLines={draft ? { id: draft.file, range: { start: draft.line, end: draft.endLine, side: draft.side } } : null}
          onSelectedLinesChange={(sel) => {
            if (!sel) return
            const side = (sel.range.endSide ?? sel.range.side ?? 'additions') as Side
            setDraft({ file: sel.id, side, line: Math.min(sel.range.start, sel.range.end), endLine: Math.max(sel.range.start, sel.range.end) })
          }}
          renderAnnotation={(a) => {
            const meta = a.metadata
            if (!meta) return null
            const wrap = (node: React.ReactNode) => <div className="flex max-w-[860px] flex-col gap-1.5 py-2 pr-3 pl-16 font-sans">{node}</div>
            if (meta.kind === 'peek' && peek)
              return wrap(
                <CodePeek
                  peek={peek}
                  titleOf={(id) => {
                    const b = data.blocks.get(id)
                    return b && blockTitle(data, b)
                  }}
                  onGo={(id) => {
                    setPeek(null)
                    p.onGo(id)
                  }}
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
                      onComment={(body) => setDraft({ file: t.file, side: t.side, line: t.line, endLine: t.line, body })}
                      onHover={(rect) => showHover(t.id, rect)}
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
                        const about = `${draft.file.split('/').pop()}:${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`
                        p.onAskAt({ file: draft.file, side: draft.side, line: draft.endLine, about, code: suggestionSeed ?? undefined }, 'What do these lines do, and is anything off?')
                        setDraft(null)
                      }}
                    >
                      Explain these lines with {p.agentName}
                    </Button>
                  )}
                  <Composer
                    key={draft.body ?? 'new'}
                    kinds={copy.kinds}
                    initialBody={draft.body}
                    placeholder={`Comment on line ${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`}
                    suggestionSeed={draft.body ? null : suggestionSeed}
                    onCancel={() => setDraft(null)}
                    onSave={(body: string, kind: CommentKind, suggestion?: string) => {
                      p.onComment({ body, kind, suggestion, file: draft.file, side: draft.side, line: draft.line, endLine: draft.endLine })
                      setDraft(null)
                    }}
                  />
                </>,
              )
            const c = meta.kind === 'note' && p.comments.find((x) => x.id === meta.id)
            return c ? wrap(<CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />) : null
          }}
        />
      )}
    </main>
  )
}

function MenuItem({ label, hint, onClick }: { label: string; hint?: string; onClick(): void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-4 rounded-md px-2.5 py-1.5 text-left text-sm text-fg hover:bg-line">
      {label}
      {hint && <span className="ml-auto text-xs text-fg-faint">{hint}</span>}
    </button>
  )
}
