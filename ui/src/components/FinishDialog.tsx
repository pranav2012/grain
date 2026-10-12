import { useState } from 'react'
import type { LoadedPr } from '../data'
import { blockTitle } from '../data'
import { kindLabel, modes } from '../modes'
import type { BlockState, Mode, ReviewComment } from '../types'

type Verdict = 'comment' | 'approve' | 'request_changes'

interface Props {
  data: LoadedPr
  mode: Mode
  states: Record<number, BlockState>
  comments: ReviewComment[]
  reviewable: number[]
  onClose(): void
}

/** Builds the markdown handed to the author's coding agent from self-review notes. */
function agentPrompt(data: LoadedPr, comments: ReviewComment[]): string {
  const lines = ['Please address these review notes on my current changes:', '']
  for (const c of comments) {
    const where = c.file ? `${c.file}:${c.line}${c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''}` : blockTitle(data, data.blocks.get(c.blockId)!)
    lines.push(`- [${kindLabel[c.kind]}] ${where}: ${c.body}`)
  }
  return lines.join('\n')
}

export function FinishDialog({ data, mode, states, comments, reviewable, onClose }: Props) {
  const reviewed = reviewable.filter((id) => states[id]).length
  const changes = reviewable.filter((id) => states[id] === 'change').length
  const [verdict, setVerdict] = useState<Verdict>(changes ? 'request_changes' : reviewed === reviewable.length ? 'approve' : 'comment')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)
  const left = reviewable.length - reviewed

  const tally = (
    <div className="tally">
      <div>
        <b>
          {reviewed}/{reviewable.length}
        </b>
        <span>blocks reviewed</span>
      </div>
      <div>
        <b>{comments.length}</b>
        <span>{mode === 'self' ? 'notes' : 'comments'}</span>
      </div>
      <div>
        <b style={{ color: changes ? 'var(--coral)' : undefined }}>{changes}</b>
        <span>{mode === 'self' ? 'blocks to fix' : 'changes requested'}</span>
      </div>
    </div>
  )

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={modes[mode].finish} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{modes[mode].finish}</h2>
        {tally}
        {left > 0 && <p>{left} blocks are still unreviewed. You can finish now and come back to them later.</p>}
        {mode === 'self' ? (
          <>
            <p>Hand your notes to your coding agent as one prompt, then push when the fixes look right.</p>
            <textarea readOnly value={comments.length ? agentPrompt(data, comments) : 'No notes yet. Add notes with c, or select lines in the diff.'} />
            <div className="footer">
              <button className="btn" onClick={onClose}>
                Keep reviewing
              </button>
              <button
                className="btn primary"
                disabled={!comments.length}
                onClick={() => navigator.clipboard.writeText(agentPrompt(data, comments)).then(() => setCopied(true))}
              >
                {copied ? 'Copied' : 'Copy prompt for agent'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="choices" role="radiogroup">
              {(
                [
                  ['comment', 'Comment', 'Share your comments without a decision.'],
                  ['approve', 'Approve', 'The change is good to merge.'],
                  ['request_changes', 'Request changes', 'The author must address your comments before merging.'],
                ] as [Verdict, string, string][]
              ).map(([v, label, help]) => (
                <button key={v} className="choice" role="radio" aria-checked={verdict === v} onClick={() => setVerdict(v)}>
                  <span>{verdict === v ? '●' : '○'}</span>
                  <span>
                    {label}
                    <small>{help}</small>
                  </span>
                </button>
              ))}
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Overall comment (optional)" />
            <p style={{ margin: '10px 0 0', fontSize: 12 }}>
              Posts one GitHub review on #{data.pr?.number} with {comments.filter((c) => c.file).length} line comments. Prototype: nothing is posted yet.
            </p>
            <div className="footer">
              <button className="btn" onClick={onClose}>
                Keep reviewing
              </button>
              <button className="btn primary" onClick={onClose}>
                {verdict === 'approve' ? 'Approve on GitHub' : verdict === 'request_changes' ? 'Request changes on GitHub' : 'Comment on GitHub'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
