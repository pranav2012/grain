import type { LoadedPr } from '../data'
import { summaryOf } from '../data'
import { meaningfulEntities, shortPath } from '../data'
import { modes } from '../modes'
import type { Block, CommentKind, Mode, ReviewComment } from '../types'
import { CommentCard, Composer } from './Composer'
import { Inline } from './Inline'

interface Props {
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

export function ContextPanel({ data, block, mode, comments, composing, agentName, onCompose, onComment, onDeleteComment }: Props) {
  const s = summaryOf(data, block)
  const copy = modes[mode]
  const askKind: CommentKind = mode === 'self' ? 'fix' : 'question'
  const entities = meaningfulEntities(block)

  return (
    <aside className="context" aria-label="Block context">
      {block.checks.length > 0 && (
        <section className="ctx-section">
          <h3>Checks</h3>
          <ul>
            {block.checks.map((c) => (
              <li key={c.text} className={`check ${c.level}`}>
                {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s?.reviewer_questions?.length ? (
        <section className="ctx-section">
          <h3>Worth checking</h3>
          <ul>
            {s.reviewer_questions.map((q) => (
              <li key={q} className="question">
                <span>
                  <Inline text={q} />
                </span>
                <button className="link" onClick={() => onComment({ body: q, kind: askKind })}>
                  {mode === 'self' ? 'Send to agent' : 'Ask'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {s?.risk_reasons?.length ? (
        <section className="ctx-section">
          <h3>Why it could break</h3>
          <ul>
            {s.risk_reasons.map((r) => (
              <li key={r} className="reason">
                <Inline text={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {s && agentName && <div className="attribution">Summary and questions written by {agentName} from this block's diff. Checks come from Grain's own rules.</div>}

      <section className="ctx-section">
        <h3>Your notes on this block</h3>
        <ul>
          {comments.map((c) => (
            <li key={c.id}>
              <CommentCard c={c} onDelete={() => onDeleteComment(c.id)} />
            </li>
          ))}
        </ul>
        <div style={{ marginTop: comments.length ? 10 : 0 }}>
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
            <button className="btn" onClick={() => onCompose(copy.kinds[0][0])}>
              Add a note <kbd>c</kbd>
            </button>
          )}
        </div>
        <p className="attribution" style={{ padding: '8px 0 0' }}>
          Select line numbers in the diff to comment on specific lines.
        </p>
      </section>

      <section className="ctx-section">
        <h3>Grouped together because they change</h3>
        <ul>
          {entities.slice(0, 8).map((e, i) => (
            <li key={i} className="entity" title={e}>
              {e}
            </li>
          ))}
          {entities.length > 8 && <li className="entity">and {entities.length - 8} more</li>}
        </ul>
      </section>

      <section className="ctx-section">
        <h3>Files</h3>
        <ul>
          {block.files.map((f) => (
            <li key={f} className="entity" title={f}>
              {shortPath(f)}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
