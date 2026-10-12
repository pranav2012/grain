import { useEffect, useMemo, useRef, useState } from 'react'
import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from '@pierre/diffs/react'
import { Button } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { Segmented } from '@/components/ui/Segmented'
import { formatMinutes, minutesFor, shortPath } from '@/lib/format'
import type { Chapter } from '@/types/generated/Chapter'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { useStepDiff } from '../hooks/useStepDiff'
import { chapterSummaryOf } from '../model/describe'
import { modes } from '../model/modes'
import { chapterBlocks, chapterHighlights, kindLabel, linesOf } from '../model/story'
import { newLines } from '../model/suggestion'
import type { Ask, BlockState, CommentKind, DiffStyle, LoadedPr, Mode, ReviewComment, Side } from '../model/types'
import { BlockCard } from './BlockCard'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ThreadCard } from './ThreadCard'

type Note = { kind: 'draft' } | { kind: 'note'; id: string } | { kind: 'thread'; id: string }
type NewComment = Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>

interface Draft {
  blockId: number
  file: string
  side: Side
  line: number
  endLine: number
}

interface ChapterViewProps {
  data: LoadedPr
  chapter: Chapter
  next?: Chapter
  mode: Mode
  diffStyle: DiffStyle
  states: Record<number, BlockState>
  stale: Record<number, string>
  currentBlock: number
  comments: ReviewComment[]
  threadsFor(blockId: number): ReviewThread[]
  owned: Set<number>
  agentName: string | null
  summaryPending(key: string): boolean
  composeTick: number
  asksFor(blockKey: string): Ask[]
  onAsk(blockId: number, question: string, code?: string, about?: string): void
  /** Scrolls to this change when it (or `n`) changes. */
  focusRequest: { blockId: number; n: number } | null
  onFocus(blockId: number): void
  onMark(blockId: number, state: BlockState | null): void
  onExplain(blockId: number): void
  onApproveAll(): void
  onDiffStyle(style: DiffStyle): void
  onNextChapter(): void
  onComment(blockId: number, c: NewComment): void
  onDeleteComment(id: string): void
}

const baseOptions: CodeViewReactOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  stickyHeaders: false,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  layout: { paddingTop: 0, paddingBottom: 24, gap: 4 },
  unsafeCSS: '* { --diffs-dark-bg: var(--color-canvas) !important; }',
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0)

/** Item id for one file of one change. */
const itemId = (blockId: number, file: string) => `${blockId}|${file}`

/**
 * One chapter as a single scrolling page: its intro, then each change (a card, then its files),
 * grouped into sections. Line comments, threads and the composer render inline in the diff.
 */
export function ChapterView(p: ChapterViewProps) {
  const { data, chapter } = p
  const copy = modes[p.mode]
  const ids = useMemo(() => chapterBlocks(chapter), [chapter])
  const blocks = useMemo(() => ids.map((id) => data.blocks.get(id)!), [ids, data])
  const nextFiles = useMemo(() => p.next && chapterBlocks(p.next).slice(0, 3).flatMap((id) => data.blocks.get(id)!.files), [p.next, data])
  const { parts, error } = useStepDiff(data.id, data.pr?.headSha ?? '', blocks, undefined, nextFiles)
  const [draft, setDraft] = useState<Draft | null>(null)
  const options = useMemo(() => ({ ...baseOptions, diffStyle: p.diffStyle }), [p.diffStyle])
  const intro = chapterSummaryOf(data, chapter)
  const view = useRef<CodeViewHandle<Note, undefined>>(null)
  const lines = linesOf(data, ids)
  const done = ids.filter((id) => p.states[id]).length

  // Where each item sits: the first file of a change carries its card; the first change of a section its heading.
  const { items, meta } = useMemo(() => {
    const meta = new Map<string, { blockId: number; first: boolean; section?: string }>()
    const items: CodeViewItem<Note>[] = []
    const byBlock = new Map((parts ?? []).map((x) => [x.block.id, x.diffs]))
    for (const s of chapter.sections) {
      s.blocks.forEach((blockId, bi) => {
        const block = data.blocks.get(blockId)!
        ;(byBlock.get(blockId) ?? []).forEach((fileDiff, fi) => {
          const id = itemId(blockId, fileDiff.name)
          meta.set(id, { blockId, first: fi === 0, section: fi === 0 && bi === 0 && chapter.sections.length > 1 ? s.title : undefined })
          const annotations: DiffLineAnnotation<Note>[] = p.comments
            .filter((c) => c.blockKey === block.key && c.file === fileDiff.name && c.line)
            .map((c) => ({ side: c.side ?? 'additions', lineNumber: c.endLine ?? c.line!, metadata: { kind: 'note', id: c.id } }))
          for (const t of p.threadsFor(blockId))
            if (t.path === fileDiff.name && t.line && !t.outdated)
              annotations.push({ side: t.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: t.line, metadata: { kind: 'thread', id: t.id } })
          if (draft?.blockId === blockId && draft.file === fileDiff.name) annotations.push({ side: draft.side, lineNumber: draft.endLine, metadata: { kind: 'draft' } })
          // The viewer re-renders an item only when its version changes, so it covers everything the card shows.
          const shown = [p.states[blockId], p.stale[blockId], p.currentBlock === blockId, p.summaryPending(block.key), !!data.summaries[block.key], p.composeTick, p.comments.filter((c) => c.blockKey === block.key).length, annotations.length, draft ? `${draft.blockId}:${draft.line}` : '']
          items.push({ id, type: 'diff', fileDiff, annotations, version: hash(JSON.stringify(shown)) })
        })
      })
    }
    return { items, meta }
  }, [parts, chapter, data, p, draft])

  const ready = items.length > 0
  useEffect(() => {
    if (!ready || !p.focusRequest) return
    const first = items.find((it) => it.id.startsWith(`${p.focusRequest!.blockId}|`))
    if (first) view.current?.scrollTo({ type: 'item', id: first.id, align: 'start', offset: -8 })
    // Only a new request scrolls; re-renders of the same chapter keep the reader's position.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusRequest, ready])

  const threadById = (id: string) => blocks.flatMap((b) => p.threadsFor(b.id)).find((t) => t.id === id)
  const draftDiff = draft && parts?.find((x) => x.block.id === draft.blockId)?.diffs.find((d) => d.name === draft.file)
  const suggestionSeed = draft && draft.side === 'additions' && draftDiff ? newLines(draftDiff, draft.line, draft.endLine) : null
  const noDiff = parts ? parts.filter((x) => !x.diffs.length).map((x) => x.block) : []

  const header = (
    <header className="border-b border-line px-6 pt-5 pb-4 font-sans">
      <p className="text-xs text-fg-subtle">
        {kindLabel[chapter.kind]}
        {chapter.entry && <span className="font-mono"> · {chapter.entry}</span>}
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-[-0.015em] break-all">{chapter.title}</h1>
      <div className="mt-1.5 max-w-[90ch] leading-relaxed text-fg-muted">
        {intro ? (
          <p>
            <InlineCode text={intro.intent} />
          </p>
        ) : (
          <p>
            {chapter.about}. Touches {chapterHighlights(data, chapter)}.
          </p>
        )}
        {intro && intro.walkthrough.length > 0 && (
          <ol className="mt-1.5 list-inside list-decimal text-sm text-fg-subtle marker:text-fg-faint">
            {intro.walkthrough.map((w) => (
              <li key={w}>
                <InlineCode text={w} />
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
        <span>
          {done}/{ids.length} changes reviewed · {lines} lines · about {formatMinutes(minutesFor(lines))}
        </span>
        {chapter.kind === 'routine' && done < ids.length && (
          <Button size="sm" variant="primary" onClick={p.onApproveAll}>
            ✓ Approve all {ids.length} routine changes
          </Button>
        )}
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
    </header>
  )

  const footer = (
    <div className="mx-4 mt-6 mb-10 flex flex-col gap-3 font-sans">
      {noDiff.length > 0 && <p className="text-xs text-fg-faint">{noDiff.length} changes only rename or move files and have no lines to show.</p>}
      {p.next && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
          <span className="text-fg-subtle">Next:</span>
          <span className="min-w-0 truncate font-medium">{p.next.title}</span>
          <Button size="sm" className="ml-auto" onClick={p.onNextChapter}>
            Continue <Kbd>⇧J</Kbd>
          </Button>
        </div>
      )}
    </div>
  )

  if (!parts)
    return (
      <main className="flex min-h-0 flex-col [grid-area:main]">
        {header}
        <div className="m-auto text-fg-subtle">{error ?? 'Loading the diff…'}</div>
      </main>
    )

  return (
    <main className="flex min-h-0 min-w-0 flex-col [grid-area:main]">
      <CodeView<Note, undefined>
        ref={view}
        key={`${chapter.key}-${p.diffStyle}`}
        className="min-h-0 flex-1 overflow-auto bg-canvas"
        items={items}
        options={options}
        renderCodeViewHeader={() => header}
        renderCodeViewFooter={() => footer}
        renderCustomHeader={(item) => {
          const m = meta.get(item.id)
          if (!m) return null
          const block = data.blocks.get(m.blockId)!
          const fileDiff = item.type === 'diff' ? item.fileDiff : null
          const added = fileDiff?.hunks.reduce((n, h) => n + h.additionLines, 0) ?? 0
          const removed = fileDiff?.hunks.reduce((n, h) => n + h.deletionLines, 0) ?? 0
          return (
            <div className="font-sans">
              {m.section && (
                <h3 className="mx-4 mt-7 flex items-baseline gap-2 text-sm font-semibold text-fg-muted">
                  {m.section}
                  <span className="text-xs font-normal text-fg-faint">
                    {chapter.sections.find((s) => s.title === m.section)?.blocks.length} changes
                  </span>
                </h3>
              )}
              {m.first && (
                <BlockCard
                  data={data}
                  block={block}
                  mode={p.mode}
                  current={p.currentBlock === m.blockId}
                  state={p.states[m.blockId]}
                  stale={!!p.stale[m.blockId]}
                  owned={p.owned.has(m.blockId)}
                  notes={p.comments.filter((c) => c.blockKey === block.key && !c.line)}
                  outdated={p.threadsFor(m.blockId).filter((t) => !t.line || t.outdated)}
                  agentName={p.agentName}
                  summaryPending={p.summaryPending(block.key)}
                  composeTick={p.composeTick}
                  asks={p.asksFor(block.key)}
                  onAsk={(q) => p.onAsk(m.blockId, q)}
                  onFocus={() => p.onFocus(m.blockId)}
                  onMark={(s) => p.onMark(m.blockId, s)}
                  onExplain={() => p.onExplain(m.blockId)}
                  onComment={(c) => p.onComment(m.blockId, c)}
                  onDeleteComment={p.onDeleteComment}
                />
              )}
              <div className="mx-4 flex items-center justify-between rounded-t-md border border-b-0 border-line bg-surface px-3 py-1.5 font-mono text-xs text-fg-muted">
                <span className="truncate" title={item.id.split('|').slice(1).join('|')}>
                  {shortPath(item.id.split('|').slice(1).join('|'))}
                </span>
                <span className="shrink-0 pl-3">
                  <span className="text-danger">−{removed}</span> <span className="text-success">+{added}</span>
                </span>
              </div>
            </div>
          )
        }}
        selectedLines={draft ? { id: itemId(draft.blockId, draft.file), range: { start: draft.line, end: draft.endLine, side: draft.side } } : null}
        onSelectedLinesChange={(sel) => {
          if (!sel) return
          const [blockId, ...rest] = sel.id.split('|')
          const side = (sel.range.endSide ?? sel.range.side ?? 'additions') as Side
          p.onFocus(Number(blockId))
          setDraft({ blockId: Number(blockId), file: rest.join('|'), side, line: Math.min(sel.range.start, sel.range.end), endLine: Math.max(sel.range.start, sel.range.end) })
        }}
        renderAnnotation={(a) => {
          const meta = a.metadata
          if (!meta) return null
          const wrap = (node: React.ReactNode) => <div className="flex max-w-[760px] flex-col gap-1.5 py-2 pr-3 pl-16 font-sans">{node}</div>
          if (meta.kind === 'thread') {
            const t = threadById(meta.id)
            return t ? wrap(<ThreadCard thread={t} />) : null
          }
          if (meta.kind === 'draft' && draft)
            return wrap(
              <>
                {p.agentName && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start text-accent"
                    onClick={() => {
                      const range = `${draft.file.split('/').pop()}:${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`
                      p.onAsk(draft.blockId, 'What do these lines do, and is anything off?', suggestionSeed ?? undefined, range)
                      setDraft(null)
                    }}
                  >
                    Explain these lines with {p.agentName}
                  </Button>
                )}
                <Composer
                kinds={copy.kinds}
                placeholder={`Comment on line ${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`}
                suggestionSeed={suggestionSeed}
                onCancel={() => setDraft(null)}
                onSave={(body: string, kind: CommentKind, suggestion?: string) => {
                  p.onComment(draft.blockId, { body, kind, suggestion, file: draft.file, side: draft.side, line: draft.line, endLine: draft.endLine })
                  setDraft(null)
                }}
              />
              </>,
            )
          const c = meta.kind === 'note' && p.comments.find((x) => x.id === meta.id)
          return c ? wrap(<CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />) : null
        }}
      />
    </main>
  )
}
