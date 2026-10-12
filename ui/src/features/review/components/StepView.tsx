import { useMemo, useState } from 'react'
import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import { CodeView, type CodeViewReactOptions } from '@pierre/diffs/react'
import { Button, LinkButton } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { Segmented } from '@/components/ui/Segmented'
import { cn } from '@/lib/cn'
import { formatMinutes, minutesFor } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { useStepDiff } from '../hooks/useStepDiff'
import { layerSummaryOf, riskOf } from '../model/describe'
import { modes } from '../model/modes'
import { stepLines, stepTitle, type StepState } from '../model/steps'
import { newLines } from '../model/suggestion'
import type { CommentKind, DiffStyle, LoadedPr, Mode, ReviewComment, Side, Step } from '../model/types'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ThreadCard } from './ThreadCard'

type Note = { kind: 'draft' } | { kind: 'note'; id: string } | { kind: 'thread'; id: string }

interface Draft {
  blockId: number
  file: string
  side: Side
  line: number
  endLine: number
}

type NewComment = Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>

interface StepViewProps {
  data: LoadedPr
  step: Step
  stage: string
  /** Position inside the stage, from 1, and the stage's step count. */
  position: number
  of: number
  next?: Step
  mode: Mode
  diffStyle: DiffStyle
  state: StepState
  /** Head commit the step was reviewed at, when it has changed since. */
  staleSince?: string
  comments: ReviewComment[]
  threadsFor(blockId: number): ReviewThread[]
  owned: boolean
  agentName: string | null
  summaryPending: boolean
  onSummarize(): void
  onOverview(): void
  onDiffStyle(style: DiffStyle): void
  onPrimary(): void
  onSecondary(): void
  onNext(): void
  onComment(blockId: number, c: NewComment): void
  onDeleteComment(id: string): void
}

const baseOptions: CodeViewReactOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  stickyHeaders: true,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  layout: { paddingTop: 0, paddingBottom: 24, gap: 12 },
  unsafeCSS: '* { --diffs-dark-bg: var(--color-canvas) !important; }',
}

const riskColor = { high: 'text-danger', medium: 'text-warning', low: 'text-success', unknown: 'text-fg-subtle' } as const
const riskRank = ['high', 'medium', 'unknown', 'low'] as const

/** One step of the review: what it changes, the verdict buttons, then every file in one scroll. */
export function StepView(p: StepViewProps) {
  const { data, step } = p
  const copy = modes[p.mode]
  const blocks = useMemo(() => step.blocks.map((id) => data.blocks.get(id)!), [step, data])
  const summary = step.layer && layerSummaryOf(data, step.layer)
  const lines = stepLines(data, step)
  const risk = riskRank.find((r) => step.blocks.some((id) => riskOf(data, id) === r)) ?? 'unknown'
  const [draft, setDraft] = useState<Draft | null>(null)
  const [view, setView] = useState<'since' | 'whole'>('since')
  const sinceReview = p.staleSince && view === 'since' ? p.staleSince : undefined
  const nextFiles = useMemo(() => p.next?.blocks.flatMap((id) => data.blocks.get(id)!.files), [p.next, data])
  const { parts, error } = useStepDiff(data.id, data.pr?.headSha ?? '', blocks, sinceReview, nextFiles)
  const options = useMemo(() => ({ ...baseOptions, diffStyle: p.diffStyle, enableLineSelection: !sinceReview }), [p.diffStyle, sinceReview])

  const items = useMemo<CodeViewItem<Note>[]>(() => {
    return (parts ?? []).flatMap(({ block, diffs }) =>
      diffs.map((fileDiff) => {
        const id = `${block.id}|${fileDiff.name}`
        const annotations: DiffLineAnnotation<Note>[] = p.comments
          .filter((c) => c.blockKey === block.key && c.file === fileDiff.name && c.line)
          .map((c): DiffLineAnnotation<Note> => ({ side: c.side ?? 'additions', lineNumber: c.endLine ?? c.line!, metadata: { kind: 'note', id: c.id } }))
        for (const t of p.threadsFor(block.id)) {
          if (t.path === fileDiff.name && t.line && !t.outdated)
            annotations.push({ side: t.side === 'LEFT' ? 'deletions' : 'additions', lineNumber: t.line, metadata: { kind: 'thread', id: t.id } })
        }
        if (draft?.blockId === block.id && draft.file === fileDiff.name) annotations.push({ side: draft.side, lineNumber: draft.endLine, metadata: { kind: 'draft' } })
        return { id, type: 'diff', fileDiff, annotations, version: annotations.length * 2 + (draft ? 1 : 0) }
      }),
    )
  }, [parts, p, draft])

  const draftDiff = draft && parts?.find((x) => x.block.id === draft.blockId)?.diffs.find((d) => d.name === draft.file)
  const suggestionSeed = draft && draft.side === 'additions' && draftDiff ? newLines(draftDiff, draft.line, draft.endLine) : null
  const threadById = (id: string) => blocks.flatMap((b) => p.threadsFor(b.id)).find((t) => t.id === id)
  const allFiles = [...new Set(blocks.flatMap((b: Block) => b.files))]

  const header = (
    <header className="border-b border-line px-6 pt-4 pb-4 font-sans">
      <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <LinkButton onClick={p.onOverview}>← Overview</LinkButton>
        <span aria-hidden>·</span>
        <span>{p.stage}</span>
        <span aria-hidden>·</span>
        <span>
          step {p.position} of {p.of}
        </span>
      </div>
      <h1 className="mt-1.5 mb-1 max-w-[70ch] text-xl font-semibold tracking-[-0.015em]">{stepTitle(data, step)}</h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
        <span className="font-mono" title={allFiles.join('\n')}>
          {step.layer?.title ?? `${allFiles.length} files`}
        </span>
        <span>
          {lines} lines, about {formatMinutes(minutesFor(lines))}
        </span>
        {!blocks.every((b) => b.skim) && (
          <span className={cn('inline-flex items-center gap-1.5 before:size-1.5 before:rounded-full before:bg-current', riskColor[risk])}>
            {risk === 'unknown' ? 'Risk unknown' : `${risk[0].toUpperCase()}${risk.slice(1)} risk`}
          </span>
        )}
        {p.owned && <span className="text-accent">You own this code</span>}
        {blocks.some((b) => b.hasTests) && <span>Includes tests</span>}
      </div>
      {summary && (
        <p className="mt-2.5 max-w-[78ch] leading-relaxed text-fg-muted">
          <InlineCode text={summary.intent} />
        </p>
      )}
      {p.staleSince && p.state !== 'done' && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <span className="text-warning">Changed since you reviewed it.</span>
          <Segmented<'since' | 'whole'>
            label="What to show"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              ['since', 'Since your review'],
              ['whole', 'Whole step'],
            ]}
          />
        </div>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={p.onPrimary}>
          {p.state === 'done' ? '✓ Reviewed' : `✓ ${copy.primary}`} <Kbd>space</Kbd>
        </Button>
        <Button variant="danger" onClick={p.onSecondary}>
          {copy.secondary} <Kbd>x</Kbd>
        </Button>
        {p.agentName && step.layer && !summary && (
          <Button variant="ghost" onClick={p.onSummarize} disabled={p.summaryPending}>
            {p.summaryPending ? `Explaining with ${p.agentName}…` : `Explain with ${p.agentName}`} <Kbd>a</Kbd>
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
    <div className="mx-6 mt-2 mb-10 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 font-sans">
      <span className="text-fg-subtle">{p.state === 'done' ? 'Reviewed.' : 'Done with this step?'}</span>
      {p.state !== 'done' && (
        <Button variant="primary" size="sm" onClick={p.onPrimary}>
          ✓ {copy.primary} <Kbd>space</Kbd>
        </Button>
      )}
      <span className="ml-auto min-w-0 truncate text-xs text-fg-faint">{p.next ? `Next: ${stepTitle(data, p.next)}` : 'Last step'}</span>
      {p.next && (
        <Button size="sm" onClick={p.onNext}>
          Next <Kbd>j</Kbd>
        </Button>
      )}
    </div>
  )

  return (
    <main className="flex min-h-0 min-w-0 flex-col [grid-area:main]">
      {!parts ? (
        <>
          {header}
          <div className="m-auto text-fg-subtle">{error ?? 'Loading the diff…'}</div>
        </>
      ) : items.length === 0 ? (
        <>
          {header}
          <div className="m-auto max-w-[44ch] text-center leading-relaxed text-fg-subtle">
            {sinceReview ? 'Nothing in these files changed since your review.' : 'This step only renames or moves files. There are no line changes to show.'}
          </div>
        </>
      ) : (
        <CodeView<Note, undefined>
          key={`${step.key}-${p.diffStyle}-${sinceReview ?? ''}`}
          className="min-h-0 flex-1 overflow-auto bg-canvas"
          items={items}
          options={options}
          renderCodeViewHeader={() => header}
          renderCodeViewFooter={() => footer}
          selectedLines={draft ? { id: `${draft.blockId}|${draft.file}`, range: { start: draft.line, end: draft.endLine, side: draft.side } } : null}
          onSelectedLinesChange={(sel) => {
            if (!sel) return
            const [blockId, ...rest] = sel.id.split('|')
            const side = (sel.range.endSide ?? sel.range.side ?? 'additions') as Side
            setDraft({
              blockId: Number(blockId),
              file: rest.join('|'),
              side,
              line: Math.min(sel.range.start, sel.range.end),
              endLine: Math.max(sel.range.start, sel.range.end),
            })
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
                <Composer
                  kinds={copy.kinds}
                  placeholder={`Comment on line ${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`}
                  suggestionSeed={suggestionSeed}
                  onCancel={() => setDraft(null)}
                  onSave={(body: string, kind: CommentKind, suggestion?: string) => {
                    p.onComment(draft.blockId, { body, kind, suggestion, file: draft.file, side: draft.side, line: draft.line, endLine: draft.endLine })
                    setDraft(null)
                  }}
                />,
              )
            const c = meta.kind === 'note' && p.comments.find((x) => x.id === meta.id)
            return c ? wrap(<CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />) : null
          }}
        />
      )}
    </main>
  )
}
