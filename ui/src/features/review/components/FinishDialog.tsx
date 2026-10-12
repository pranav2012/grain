import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Choice, ChoiceGroup } from '@/components/ui/Choice'
import { Dialog, DialogActions, DialogTitle } from '@/components/ui/Dialog'
import { Textarea } from '@/components/ui/Field'
import type { ReviewEvent } from '@/types/generated/ReviewEvent'
import type { SubmitResponse } from '@/types/generated/SubmitResponse'
import { reviewApi } from '../api'
import { blockTitle } from '../model/describe'
import { kindLabel, modes } from '../model/modes'
import { buildSubmission } from '../model/submission'
import type { BlockState, LoadedPr, Mode, ReviewComment } from '../model/types'

interface FinishDialogProps {
  data: LoadedPr
  mode: Mode
  states: Record<number, BlockState>
  comments: ReviewComment[]
  reviewable: number[]
  onPosted(ids: string[]): void
  onClose(): void
}

/** Builds the markdown handed to the author's coding agent from self-review notes. */
function agentPrompt(data: LoadedPr, comments: ReviewComment[]): string {
  const lines = ['Please address these review notes on my current changes:', '']
  for (const c of comments) {
    const range = c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''
    const where = c.file ? `${c.file}:${c.line}${range}` : blockTitle(data, data.blocks.get(c.blockId)!)
    lines.push(`- [${kindLabel[c.kind]}] ${where}: ${c.body || 'Replace these lines.'}`)
    if (c.suggestion !== undefined) lines.push('  Replace with:', '  ```', ...c.suggestion.split('\n').map((l) => `  ${l}`), '  ```')
  }
  return lines.join('\n')
}

const verdicts: [ReviewEvent, string, string][] = [
  ['COMMENT', 'Comment', 'Share your comments without a decision.'],
  ['APPROVE', 'Approve', 'The change is good to merge.'],
  ['REQUEST_CHANGES', 'Request changes', 'The author must address your comments before merging.'],
]

const postLabel: Record<ReviewEvent, string> = {
  COMMENT: 'Post comments to GitHub',
  APPROVE: 'Approve on GitHub',
  REQUEST_CHANGES: 'Request changes on GitHub',
}

export function FinishDialog({ data, mode, states, comments, reviewable, onPosted, onClose }: FinishDialogProps) {
  const reviewed = reviewable.filter((id) => states[id]).length
  const changes = reviewable.filter((id) => states[id] === 'change').length
  const unposted = comments.filter((c) => !c.postedAt)
  const [event, setEvent] = useState<ReviewEvent>(changes ? 'REQUEST_CHANGES' : reviewed === reviewable.length ? 'APPROVE' : 'COMMENT')
  const [overall, setOverall] = useState('')
  const [preview, setPreview] = useState<SubmitResponse | null>(null)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const left = reviewable.length - reviewed
  const selfReview = mode === 'self'
  const effectiveEvent: ReviewEvent = selfReview ? 'COMMENT' : event
  const nothingToPost = !unposted.length && !overall.trim() && effectiveEvent === 'COMMENT'
  const local = !!data.pr?.local

  useEffect(() => {
    if (local) return
    let alive = true
    reviewApi.submit(data.id, buildSubmission(data, comments, effectiveEvent, overall, true)).then(
      (r) => alive && setPreview(r),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [data, comments, effectiveEvent, overall, local])

  const post = () => {
    setPosting(true)
    setError(null)
    reviewApi.submit(data.id, buildSubmission(data, comments, effectiveEvent, overall, false)).then(
      (r) => {
        setPosted(r.url ?? '')
        onPosted(unposted.map((c) => c.id))
        setPosting(false)
      },
      (e: Error) => {
        setError(e.message)
        setPosting(false)
      },
    )
  }

  const tally: [string | number, string, boolean?][] = [
    [`${reviewed}/${reviewable.length}`, 'blocks reviewed'],
    [unposted.length, selfReview ? 'notes' : 'comments to post'],
    [changes, selfReview ? 'blocks to fix' : 'changes requested', changes > 0],
  ]

  if (posted !== null)
    return (
      <Dialog label="Review posted" onClose={onClose} className="p-5">
        <DialogTitle>Posted to GitHub</DialogTitle>
        <p className="mb-3.5 leading-relaxed text-fg-subtle">Your review is on pull request #{data.pr?.number}. Posted comments won't be sent again.</p>
        <DialogActions>
          {posted && (
            <a href={posted} target="_blank" rel="noreferrer">
              <Button>Open on GitHub</Button>
            </a>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    )

  return (
    <Dialog label={modes[mode].finish} onClose={onClose} className="p-5">
      <DialogTitle>{modes[mode].finish}</DialogTitle>
      <div className="mt-2.5 mb-1 flex gap-4.5">
        {tally.map(([n, label, alert]) => (
          <div key={label} className="flex flex-col">
            <b className={`text-xl font-semibold tabular-nums ${alert ? 'text-danger' : ''}`}>{n}</b>
            <span className="text-xs text-fg-subtle">{label}</span>
          </div>
        ))}
      </div>
      {left > 0 && <p className="mb-3 leading-relaxed text-fg-subtle">{left} blocks are still unreviewed. You can finish now and come back to them later.</p>}
      {selfReview ? (
        <>
          <p className="mb-3 leading-relaxed text-fg-subtle">
            {local
              ? 'Hand your notes to your coding agent as one prompt. Once you fix them, Grain offers to refresh and keeps the blocks you already checked.'
              : 'Hand your notes to your coding agent as one prompt, or post them on the pull request as a comment.'}
          </p>
          <Textarea readOnly value={unposted.length ? agentPrompt(data, unposted) : 'No notes yet. Add notes with c, or select lines in the diff.'} />
        </>
      ) : (
        <>
          <ChoiceGroup label="Verdict" className="my-3">
            {verdicts.map(([v, label, help]) => (
              <Choice key={v} checked={event === v} onSelect={() => setEvent(v)} label={label} help={help} />
            ))}
          </ChoiceGroup>
          <Textarea value={overall} onChange={(e) => setOverall(e.target.value)} placeholder="Overall comment (optional)" />
        </>
      )}
      {preview && (
        <p className="mt-2.5 text-xs text-fg-subtle">
          Posts one review as you with {preview.payload.comments.length} line {preview.payload.comments.length === 1 ? 'comment' : 'comments'}
          {preview.payload.body ? ' and a summary' : ''}.
          {preview.movedToBody > 0 && ` ${preview.movedToBody} ${preview.movedToBody === 1 ? 'comment is' : 'comments are'} on lines GitHub can't anchor, so they go into the summary.`}
        </p>
      )}
      {error && <p className="mt-2.5 text-danger">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>Keep reviewing</Button>
        {selfReview && (
          <Button
            variant={local ? 'primary' : undefined}
            disabled={!unposted.length}
            onClick={() => navigator.clipboard.writeText(agentPrompt(data, unposted)).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy prompt for agent'}
          </Button>
        )}
        {!local && (
          <Button variant="primary" onClick={post} disabled={posting || nothingToPost}>
            {posting ? 'Posting…' : selfReview ? 'Post as PR comment' : postLabel[event]}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
