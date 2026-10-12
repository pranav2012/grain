import type { ReactNode } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import { shortPath } from '@/lib/format'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { layerSummaryOf, summaryOf } from '../model/describe'
import { modes } from '../model/modes'
import { stepTitle } from '../model/steps'
import type { CommentKind, LoadedPr, Mode, ReviewComment, Step } from '../model/types'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'
import { ThreadCard } from './ThreadCard'

interface ContextPanelProps {
  data: LoadedPr
  step: Step
  mode: Mode
  comments: ReviewComment[]
  threads: ReviewThread[]
  /** Steps this one uses and steps that use it. */
  uses: Step[]
  usedBy: Step[]
  composing: { kind: CommentKind; body?: string } | null
  agentName: string | null
  onCompose(c: { kind: CommentKind; body?: string } | null): void
  onComment(c: Omit<ReviewComment, 'id' | 'createdAt' | 'blockId' | 'blockKey'>): void
  onDeleteComment(id: string): void
  onOpenStep(step: Step): void
}

function Section({ title, children, badge }: { title: string; children: ReactNode; badge?: boolean }) {
  return (
    <section className="px-4 pt-4 pb-1">
      <SectionLabel className="mb-2 flex items-center gap-1.5">
        {badge && <span className="rounded-sm border border-accent/40 px-1 text-2xs font-semibold text-accent">AI</span>}
        {title}
      </SectionLabel>
      {children}
    </section>
  )
}

const listClass = 'flex flex-col gap-2'
const noteClass = 'border-l-2 border-line pl-3 leading-normal text-fg-muted'
const monoRow = 'truncate font-mono text-xs leading-normal text-fg-subtle'

/** Right panel: the agent's explanation when there is one, then facts, conversation and notes. */
export function ContextPanel(p: ContextPanelProps) {
  const { data, step, mode } = p
  const copy = modes[mode]
  const blocks = step.blocks.map((id) => data.blocks.get(id)!)
  const summary = step.layer && layerSummaryOf(data, step.layer)
  const questions = [...new Set([...(summary?.reviewer_questions ?? []), ...blocks.flatMap((b) => summaryOf(data, b)?.reviewer_questions ?? [])])]
  const checks = [...new Map(blocks.flatMap((b) => b.checks).map((c) => [c.text, c])).values()]
  const files = [...new Set(blocks.flatMap((b) => b.files))]
  const owners = [...new Set(files.flatMap((f) => data.owners.files[f] ?? []))]
  const askKind: CommentKind = mode === 'self' ? 'fix' : 'question'
  const open = p.threads.filter((t) => !t.resolved).length

  return (
    <aside aria-label="Step details" className="overflow-auto border-l border-line pb-6 [grid-area:context]">
      {summary && summary.walkthrough.length > 0 && (
        <Section title="How to read it" badge>
          <ol className="flex list-inside list-decimal flex-col gap-1.5 leading-normal text-fg-muted marker:text-fg-faint">
            {summary.walkthrough.map((s) => (
              <li key={s}>
                <InlineCode text={s} />
              </li>
            ))}
          </ol>
        </Section>
      )}
      {questions.length > 0 && (
        <Section title="Worth checking" badge>
          <ul className={listClass}>
            {questions.map((q) => (
              <li key={q} className={noteClass}>
                <InlineCode text={q} />
                <LinkButton className="mt-1 block" onClick={() => p.onCompose({ kind: askKind, body: q })}>
                  Turn into comment
                </LinkButton>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(summary || questions.length > 0) && p.agentName && (
        <p className="px-4 pt-2 text-xs text-fg-faint">Written by {p.agentName}. It explains; you decide. It never marks steps or posts anything.</p>
      )}

      {(p.uses.length > 0 || p.usedBy.length > 0) && (
        <Section title="Where it fits">
          <ul className={listClass}>
            {p.uses.slice(0, 4).map((s) => (
              <li key={`u${s.key}`} className={noteClass}>
                Uses{' '}
                <LinkButton className="text-accent" onClick={() => p.onOpenStep(s)}>
                  {stepTitle(data, s)}
                </LinkButton>{' '}
                <span className="text-fg-faint">({s.stage})</span>
              </li>
            ))}
            {p.usedBy.slice(0, 4).map((s) => (
              <li key={`b${s.key}`} className={noteClass}>
                Used by{' '}
                <LinkButton className="text-accent" onClick={() => p.onOpenStep(s)}>
                  {stepTitle(data, s)}
                </LinkButton>{' '}
                <span className="text-fg-faint">({s.stage})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!data.review.complete && !blocks.every((b) => b.skim) && (
        <p className="px-4 pt-4 text-xs text-fg-faint">Still checking how this code is used across the repo. More checks may appear.</p>
      )}
      {checks.length > 0 && (
        <Section title="Checks">
          <ul className={listClass}>
            {checks.map((c) => (
              <li key={c.text} className={cn(noteClass, c.level === 'warn' && 'border-warning')}>
                {c.text}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.threads.length > 0 && (
        <Section title={`On GitHub (${open} open, ${p.threads.length - open} resolved)`}>
          <ul className={listClass}>
            {[...p.threads]
              .sort((a, b) => Number(a.resolved) - Number(b.resolved))
              .map((t) => (
                <li key={t.id}>
                  <p className="mb-1 truncate font-mono text-2xs text-fg-faint">
                    {shortPath(t.path)}
                    {t.line ? `:${t.line}` : ' (outdated)'}
                  </p>
                  <ThreadCard thread={t} compact />
                </li>
              ))}
          </ul>
        </Section>
      )}

      <Section title="Your notes">
        <ul className={listClass}>
          {p.comments.map((c) => (
            <li key={c.id}>
              <CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />
            </li>
          ))}
        </ul>
        <div className={p.comments.length ? 'mt-2.5' : ''}>
          {p.composing ? (
            <Composer
              key={p.composing.body ?? p.composing.kind}
              kinds={copy.kinds}
              initialKind={p.composing.kind}
              initialBody={p.composing.body}
              placeholder="Comment on the whole step"
              onCancel={() => p.onCompose(null)}
              onSave={(body, kind) => {
                p.onComment({ body, kind })
                p.onCompose(null)
              }}
            />
          ) : (
            <Button onClick={() => p.onCompose({ kind: copy.kinds[0][0] })}>
              Add a note <Kbd>c</Kbd>
            </Button>
          )}
        </div>
        <p className="pt-2 text-xs text-fg-faint">Select line numbers in the diff to comment on specific lines.</p>
      </Section>

      <Section title={files.length === 1 ? 'File' : `${files.length} files`}>
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li key={f} className={monoRow} title={f}>
              {shortPath(f)}
            </li>
          ))}
        </ul>
      </Section>
      {owners.length > 0 && (
        <Section title="Code owners">
          <p className="leading-normal text-fg-muted">{owners.join(', ')}</p>
        </Section>
      )}
    </aside>
  )
}
