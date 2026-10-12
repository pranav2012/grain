import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button, LinkButton } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { Block } from '@/types/generated/Block'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { blockTitle, riskOf, summaryOf } from '../model/describe'
import { modes } from '../model/modes'
import { whatChanged } from '../model/story'
import type { BlockState, CommentKind, LoadedPr, Mode, ReviewComment } from '../model/types'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ThreadCard } from './ThreadCard'

type NewComment = Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>

interface BlockCardProps {
  data: LoadedPr
  block: Block
  mode: Mode
  current: boolean
  state?: BlockState
  stale: boolean
  owned: boolean
  /** Notes on the whole change (not on a line). */
  notes: ReviewComment[]
  /** GitHub threads that no longer sit on a line of the diff. */
  outdated: ReviewThread[]
  agentName: string | null
  summaryPending: boolean
  /** Bumped by the `c` and `x` keys to open the composer on the current change. */
  composeTick: number
  onFocus(): void
  onMark(state: BlockState | null): void
  onExplain(): void
  onComment(c: NewComment): void
  onDeleteComment(id: string): void
}

const riskTone = { high: 'text-danger', medium: 'text-warning', low: 'text-success', unknown: 'text-fg-subtle' } as const

/** The heading of one change in a chapter: what it does, checks, the agent's explanation and the verdict. */
export function BlockCard(p: BlockCardProps) {
  const { data, block } = p
  const copy = modes[p.mode]
  const summary = summaryOf(data, block)
  const risk = riskOf(data, block.id)
  const [composing, setComposing] = useState<{ kind: CommentKind; body?: string } | null>(null)
  const askKind: CommentKind = p.mode === 'self' ? 'fix' : 'question'
  // A new tick from the keyboard opens the composer on the current change (state adjusted during render).
  const [seenTick, setSeenTick] = useState(p.composeTick)
  if (p.composeTick !== seenTick) {
    setSeenTick(p.composeTick)
    if (p.current) setComposing({ kind: copy.kinds[0][0] })
  }

  return (
    <div
      onMouseDown={p.onFocus}
      className={cn(
        'mx-4 mt-5 mb-2 rounded-lg border bg-surface px-4 py-3 font-sans',
        p.current ? 'border-accent' : 'border-line',
        p.state === 'ok' && !p.current && 'border-success/40',
        p.state === 'change' && !p.current && 'border-danger/50',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 className="font-semibold text-fg">{blockTitle(data, block)}</h2>
        <span className="text-xs text-fg-subtle">
          {block.lines} lines{block.files.length > 1 && ` · ${block.files.length} files`}
        </span>
        {!block.skim && <span className={cn('text-xs', riskTone[risk])}>{risk === 'unknown' ? 'risk unknown' : `${risk} risk`}</span>}
        {p.owned && <Badge tone="accent">yours</Badge>}
        {p.stale && !p.state && <Badge tone="warning">changed since your review</Badge>}
        {p.state === 'ok' && <span className="text-xs text-success">✓ reviewed</span>}
        {p.state === 'change' && <span className="text-xs text-danger">needs change</span>}
      </div>
      <p className="mt-1 max-w-[90ch] leading-relaxed text-fg-muted">{summary?.intent ? <InlineCode text={summary.intent} /> : whatChanged(block)}</p>

      {block.checks.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {block.checks.map((c) => (
            <li key={c.text} className={cn('border-l-2 pl-2.5 text-sm text-fg-muted', c.level === 'warn' ? 'border-warning' : 'border-line')}>
              {c.text}
            </li>
          ))}
        </ul>
      )}

      {summary && summary.reviewer_questions.length > 0 && (
        <div className="mt-2.5 rounded-md border-l-2 border-accent bg-canvas/40 px-3 py-2">
          <p className="mb-1 text-xs text-fg-subtle">
            <span className="mr-1.5 rounded-sm border border-accent/40 px-1 text-2xs font-semibold text-accent">AI</span>
            Worth checking
          </p>
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            {summary.reviewer_questions.map((q) => (
              <li key={q}>
                <InlineCode text={q} />{' '}
                <LinkButton onClick={() => setComposing({ kind: askKind, body: q })}>turn into comment</LinkButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.outdated.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {p.outdated.map((t) => (
            <ThreadCard key={t.id} thread={t} compact />
          ))}
        </div>
      )}
      {p.notes.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {p.notes.map((c) => (
            <CommentCard key={c.id} c={c} onDelete={() => p.onDeleteComment(c.id)} />
          ))}
        </div>
      )}
      {composing && (
        <div className="mt-2.5">
          <Composer
            key={composing.body ?? composing.kind}
            kinds={copy.kinds}
            initialKind={composing.kind}
            initialBody={composing.body}
            placeholder="Comment on this change"
            onCancel={() => setComposing(null)}
            onSave={(body, kind) => {
              p.onComment({ body, kind })
              setComposing(null)
            }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => p.onMark(p.state === 'ok' ? null : 'ok')}>
          {p.state === 'ok' ? '✓ Reviewed' : `✓ ${copy.primary}`}
          {p.current && <Kbd>space</Kbd>}
        </Button>
        <Button size="sm" variant="danger" onClick={() => p.onMark(p.state === 'change' ? null : 'change')}>
          {copy.secondary}
          {p.current && <Kbd>x</Kbd>}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setComposing({ kind: copy.kinds[0][0] })}>
          Comment{p.current && <Kbd>c</Kbd>}
        </Button>
        {p.agentName && !summary && !block.skim && (
          <Button size="sm" variant="ghost" onClick={p.onExplain} disabled={p.summaryPending} className="text-accent">
            {p.summaryPending ? `Explaining with ${p.agentName}…` : 'Explain'}
            {p.current && <Kbd>a</Kbd>}
          </Button>
        )}
        <span className="ml-auto text-xs text-fg-faint">Click a line number to comment on lines</span>
      </div>
    </div>
  )
}
