import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { shortPath } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import { meaningfulEntities, summaryOf } from '../model/describe'
import { modes } from '../model/modes'
import type { CommentKind, LoadedPr, Mode, ReviewComment } from '../model/types'
import { CommentCard } from './CommentCard'
import { Composer } from './Composer'

interface ContextPanelProps {
  data: LoadedPr
  block: Block
  mode: Mode
  comments: ReviewComment[]
  composing: CommentKind | null
  agentName: string | null
  onCompose(kind: CommentKind | null): void
  onComment(c: Omit<ReviewComment, 'id' | 'createdAt' | 'blockId'>): void
  onDeleteComment(id: string): void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-3.5 pb-1.5">
      <h3 className="mb-2 text-xs font-medium text-fog">{title}</h3>
      {children}
    </section>
  )
}

const listClass = 'flex flex-col gap-2'
const noteClass = 'border-l-2 border-seam pl-3 leading-normal text-soft'
const monoRow = 'truncate font-mono text-[11.5px] leading-normal text-fog'

export function ContextPanel({ data, block, mode, comments, composing, agentName, onCompose, onComment, onDeleteComment }: ContextPanelProps) {
  const s = summaryOf(data, block)
  const copy = modes[mode]
  const askKind: CommentKind = mode === 'self' ? 'fix' : 'question'
  const entities = meaningfulEntities(block)

  return (
    <aside aria-label="Block context" className="overflow-auto border-l border-seam pt-1.5 pb-6 [grid-area:context]">
      {block.checks.length > 0 && (
        <Section title="Checks">
          <ul className={listClass}>
            {block.checks.map((c) => (
              <li key={c.text} className={cn(noteClass, c.level === 'warn' && 'border-amber')}>
                {c.text}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s?.reviewer_questions.length ? (
        <Section title="Worth checking">
          <ul className={listClass}>
            {s.reviewer_questions.map((q) => (
              <li key={q} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 leading-normal">
                <span>
                  <InlineCode text={q} />
                </span>
                <button
                  onClick={() => onComment({ body: q, kind: askKind })}
                  className="text-xs whitespace-nowrap text-fog underline decoration-seam underline-offset-[3px] hover:text-chalk"
                >
                  {mode === 'self' ? 'Send to agent' : 'Ask'}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {s?.risk_reasons.length ? (
        <Section title="Why it could break">
          <ul className={listClass}>
            {s.risk_reasons.map((r) => (
              <li key={r} className={noteClass}>
                <InlineCode text={r} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {s && agentName && (
        <p className="px-4 pt-0.5 text-[11.5px] text-dim">Summary and questions written by {agentName} from this block's diff. Checks come from Grain's own rules.</p>
      )}

      <Section title="Your notes on this block">
        <ul className={listClass}>
          {comments.map((c) => (
            <li key={c.id}>
              <CommentCard c={c} onDelete={() => onDeleteComment(c.id)} />
            </li>
          ))}
        </ul>
        <div className={comments.length ? 'mt-2.5' : ''}>
          {composing ? (
            <Composer
              kinds={copy.kinds}
              initialKind={composing}
              placeholder="Comment on the whole block"
              onCancel={() => onCompose(null)}
              onSave={(body, kind) => {
                onComment({ body, kind })
                onCompose(null)
              }}
            />
          ) : (
            <Button onClick={() => onCompose(copy.kinds[0][0])}>
              Add a note <Kbd>c</Kbd>
            </Button>
          )}
        </div>
        <p className="pt-2 text-[11.5px] text-dim">Select line numbers in the diff to comment on specific lines.</p>
      </Section>

      <Section title="Grouped together because they change">
        <ul className={listClass}>
          {entities.slice(0, 8).map((e, i) => (
            <li key={i} className={monoRow} title={e}>
              {e}
            </li>
          ))}
          {entities.length > 8 && <li className={monoRow}>and {entities.length - 8} more</li>}
        </ul>
      </Section>

      <Section title="Files">
        <ul className={listClass}>
          {block.files.map((f) => (
            <li key={f} className={monoRow} title={f}>
              {shortPath(f)}
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  )
}
