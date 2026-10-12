import { useMemo, useState } from 'react'
import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import { CodeView, type CodeViewReactOptions } from '@pierre/diffs/react'
import { Button } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { Segmented } from '@/components/ui/Segmented'
import { cn } from '@/lib/cn'
import { formatMinutes, minutesFor } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { useBlockDiff } from '../hooks/useBlockDiff'
import { blockTitle, factsSentence, summaryOf } from '../model/describe'
import { modes } from '../model/modes'
import type { BlockState, CommentKind, DiffStyle, LoadedPr, Mode, ReviewComment, Side } from '../model/types'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ThreadCard } from './ThreadCard'

type Note = { kind: 'draft' } | { kind: 'note'; id: string } | { kind: 'thread'; id: string }

interface Draft {
  file: string
  side: Side
  line: number
  endLine: number
}

interface BlockViewProps {
  data: LoadedPr
  block: Block
  mode: Mode
  chapterTitle: string
  position: string
  diffStyle: DiffStyle
  /** Files of the next block, loaded ahead so moving on is instant. */
  nextFiles?: string[]
  /** Set when the reviewer has chosen an agent; summaries are only made on request. */
  agentName: string | null
  summaryPending: boolean
  onSummarize(): void
  onDiffStyle(style: DiffStyle): void
  state?: BlockState
  comments: ReviewComment[]
  /** Existing GitHub review threads on this block's files. */
  threads: ReviewThread[]
  onPrimary(): void
  onSecondary(): void
  onComment(c: Omit<ReviewComment, 'id' | 'createdAt' | 'blockId'>): void
  onDeleteComment(id: string): void
}

const baseOptions: CodeViewReactOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  stickyHeaders: true,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
  unsafeCSS: '* { --diffs-dark-bg: #16181d !important; }',
}

const riskColor = { high: 'text-coral', medium: 'text-amber', low: 'text-sage' } as const

export function BlockView(p: BlockViewProps) {
  const { data, block, mode } = p
  const copy = modes[mode]
  const summary = summaryOf(data, block)
  const [draft, setDraft] = useState<Draft | null>(null)
  const options = useMemo(() => ({ ...baseOptions, diffStyle: p.diffStyle }), [p.diffStyle])
  const risk = (summary?.risk as keyof typeof riskColor | undefined) ?? (block.skim ? null : block.estRisk)

  const { diffs, error: diffError } = useBlockDiff(data.id, block.files, p.nextFiles)
  const items = useMemo<CodeViewItem<Note>[]>(() => {
    return (diffs ?? []).map((fileDiff) => {
        const annotations: DiffLineAnnotation<Note>[] = p.comments
          .filter((c) => c.file === fileDiff.name && c.line)
          .map((c): DiffLineAnnotation<Note> => ({ side: c.side ?? 'additions', lineNumber: c.endLine ?? c.line!, metadata: { kind: 'note', id: c.id } }))
        for (const t of p.threads) {
          if (t.path === fileDiff.name && t.line && !t.outdated)
            annotations.push({ side: t.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: t.line, metadata: { kind: 'thread', id: t.id } })
        }
        if (draft?.file === fileDiff.name) annotations.push({ side: draft.side, lineNumber: draft.endLine, metadata: { kind: 'draft' } })
        return { id: fileDiff.name, type: 'diff', fileDiff, annotations, version: annotations.length * 2 + (draft ? 1 : 0) }
      })
  }, [diffs, p.comments, p.threads, draft])

  const missing = diffs ? block.files.length - items.length : 0

  return (
    <main className="flex min-h-0 min-w-0 flex-col [grid-area:main]">
      <header className="border-b border-seam px-6 pt-[18px] pb-3.5">
        <div className="flex items-center gap-1.5 text-xs text-fog">
          <span>{p.chapterTitle}</span>
          <span aria-hidden>/</span>
          <span>{p.position}</span>
        </div>
        <h1 className="mt-1.5 mb-2 max-w-[70ch] text-[19px] leading-tight font-semibold tracking-[-0.015em]">{blockTitle(data, block)}</h1>
        <p className="mb-2.5 max-w-[78ch] text-[13.5px] leading-relaxed text-soft">
          {summary?.intent ? <InlineCode text={summary.intent} /> : factsSentence(block)}
        </p>
        <div className="flex flex-wrap items-center gap-3.5 text-xs text-fog">
          {risk && (
            <span
              className={cn('inline-flex items-center gap-1.5 font-medium before:size-[7px] before:rounded-full before:bg-current', riskColor[risk])}
              title={summary ? 'Assessed by your agent from the diff' : 'Estimated from rules: sensitive areas, outside usage, removals, tests and size'}
            >
              {summary ? `${risk[0].toUpperCase()}${risk.slice(1)} risk` : `Estimated ${risk} risk`}
            </span>
          )}
          <span>
            {block.lines} changed lines in {block.files.length} {block.files.length === 1 ? 'file' : 'files'}
          </span>
          {block.hasTests && <span>Includes tests</span>}
          {block.skim && <span>Low attention: skim and confirm</span>}
          <span>About {formatMinutes(minutesFor(block.lines))}</span>
        </div>
        <div className="mt-3.5 flex gap-2">
          <Button variant="primary" onClick={p.onPrimary}>
            {p.state === 'ok' ? 'Reviewed' : copy.primary} <Kbd>space</Kbd>
          </Button>
          <Button variant="danger" onClick={p.onSecondary}>
            {copy.secondary} <Kbd>x</Kbd>
          </Button>
          {p.agentName && !summary && !block.skim && (
            <Button variant="ghost" onClick={p.onSummarize} disabled={p.summaryPending}>
              {p.summaryPending ? `Summarizing with ${p.agentName}…` : `Summarize with ${p.agentName}`} <Kbd>a</Kbd>
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
      {!diffs ? (
        <div className="m-auto text-fog">{diffError ?? 'Loading the diff…'}</div>
      ) : items.length === 0 ? (
        <div className="m-auto max-w-[44ch] text-center leading-relaxed text-fog">This block only renames or moves files. There are no line changes to show.</div>
      ) : (
        <CodeView<Note, undefined>
          key={`${block.id}-${p.diffStyle}`}
          className="min-h-0 flex-1 overflow-auto bg-graphite"
          items={items}
          options={options}
          selectedLines={draft ? { id: draft.file, range: { start: draft.line, end: draft.endLine, side: draft.side } } : null}
          onSelectedLinesChange={(sel) => {
            if (!sel) return
            const side = (sel.range.endSide ?? sel.range.side ?? 'additions') as Side
            setDraft({ file: sel.id, side, line: Math.min(sel.range.start, sel.range.end), endLine: Math.max(sel.range.start, sel.range.end) })
          }}
          renderAnnotation={(a) => {
            const meta = a.metadata
            if (!meta) return null
            if (meta.kind === 'thread') {
              const t = p.threads.find((x) => x.id === meta.id)
              return t ? (
                <div className="flex max-w-[760px] flex-col gap-1.5 py-2 pr-3 pl-16 font-sans">
                  <ThreadCard thread={t} />
                </div>
              ) : null
            }
            if (meta.kind === 'draft' && draft)
              return (
                <div className="flex max-w-[760px] flex-col gap-1.5 py-2 pr-3 pl-16 font-sans">
                  <Composer
                    kinds={copy.kinds}
                    placeholder={`Comment on line ${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`}
                    onCancel={() => setDraft(null)}
                    onSave={(body: string, kind: CommentKind) => {
                      p.onComment({ body, kind, file: draft.file, side: draft.side, line: draft.line, endLine: draft.endLine })
                      setDraft(null)
                    }}
                  />
                </div>
              )
            const c = meta.kind === 'note' && p.comments.find((x) => x.id === meta.id)
            return c ? (
              <div className="flex max-w-[760px] flex-col gap-1.5 py-2 pr-3 pl-16 font-sans">
                <CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />
              </div>
            ) : null
          }}
        />
      )}
      {missing > 0 && items.length > 0 && <div className="px-4 pt-0.5 text-[11.5px] text-dim">{missing} binary or unchanged files not shown.</div>}
    </main>
  )
}
