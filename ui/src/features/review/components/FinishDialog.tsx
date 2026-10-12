import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { blockTitle } from '../model/describe'
import { kindLabel, modes } from '../model/modes'
import type { BlockState, LoadedPr, Mode, ReviewComment } from '../model/types'

type Verdict = 'comment' | 'approve' | 'request_changes'

interface FinishDialogProps {
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
    const range = c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''
    const where = c.file ? `${c.file}:${c.line}${range}` : blockTitle(data, data.blocks.get(c.blockId)!)
    lines.push(`- [${kindLabel[c.kind]}] ${where}: ${c.body}`)
  }
  return lines.join('\n')
}

const verdicts: [Verdict, string, string][] = [
  ['comment', 'Comment', 'Share your comments without a decision.'],
  ['approve', 'Approve', 'The change is good to merge.'],
  ['request_changes', 'Request changes', 'The author must address your comments before merging.'],
]

export function FinishDialog({ data, mode, states, comments, reviewable, onClose }: FinishDialogProps) {
  const reviewed = reviewable.filter((id) => states[id]).length
  const changes = reviewable.filter((id) => states[id] === 'change').length
  const [verdict, setVerdict] = useState<Verdict>(changes ? 'request_changes' : reviewed === reviewable.length ? 'approve' : 'comment')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)
  const left = reviewable.length - reviewed
  const tally: [string | number, string, boolean?][] = [
    [`${reviewed}/${reviewable.length}`, 'blocks reviewed'],
    [comments.length, mode === 'self' ? 'notes' : 'comments'],
    [changes, mode === 'self' ? 'blocks to fix' : 'changes requested', changes > 0],
  ]

  return (
    <Dialog label={modes[mode].finish} onClose={onClose} className="p-5">
      <h2 className="mb-1 text-[17px] font-semibold">{modes[mode].finish}</h2>
      <div className="mt-2.5 mb-1 flex gap-[18px]">
        {tally.map(([n, label, alert]) => (
          <div key={label} className="flex flex-col">
            <b className={`text-xl font-semibold tabular-nums ${alert ? 'text-coral' : ''}`}>{n}</b>
            <span className="text-xs text-fog">{label}</span>
          </div>
        ))}
      </div>
      {left > 0 && <p className="mb-3.5 leading-relaxed text-fog">{left} blocks are still unreviewed. You can finish now and come back to them later.</p>}
      {mode === 'self' ? (
        <>
          <p className="mb-3.5 leading-relaxed text-fog">Hand your notes to your coding agent as one prompt, then push when the fixes look right.</p>
          <textarea
            readOnly
            value={comments.length ? agentPrompt(data, comments) : 'No notes yet. Add notes with c, or select lines in the diff.'}
            className="min-h-[90px] w-full resize-y rounded-lg border border-seam bg-graphite p-2.5 leading-normal"
          />
          <div className="mt-3.5 flex justify-end gap-2">
            <Button onClick={onClose}>Keep reviewing</Button>
            <Button
              variant="primary"
              disabled={!comments.length}
              onClick={() => navigator.clipboard.writeText(agentPrompt(data, comments)).then(() => setCopied(true))}
            >
              {copied ? 'Copied' : 'Copy prompt for agent'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div role="radiogroup" className="my-3 flex flex-col gap-1.5">
            {verdicts.map(([v, label, help]) => (
              <button
                key={v}
                role="radio"
                aria-checked={verdict === v}
                onClick={() => setVerdict(v)}
                className="grid grid-cols-[18px_1fr] gap-2.5 rounded-lg border border-seam px-3 py-2.5 text-left aria-checked:border-fog aria-checked:bg-slate-2"
              >
                <span>{verdict === v ? '●' : '○'}</span>
                <span>
                  {label}
                  <small className="mt-0.5 block text-fog">{help}</small>
                </span>
              </button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Overall comment (optional)"
            className="min-h-[90px] w-full resize-y rounded-lg border border-seam bg-graphite p-2.5 leading-normal"
          />
          <p className="mt-2.5 text-xs text-fog">
            Posts one GitHub review on #{data.pr?.number} with {comments.filter((c) => c.file).length} line comments. Prototype: nothing is posted yet.
          </p>
          <div className="mt-3.5 flex justify-end gap-2">
            <Button onClick={onClose}>Keep reviewing</Button>
            <Button variant="primary" onClick={onClose}>
              {verdict === 'approve' ? 'Approve on GitHub' : verdict === 'request_changes' ? 'Request changes on GitHub' : 'Comment on GitHub'}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
