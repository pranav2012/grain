import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { ago } from '@/lib/format'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { useThreadActions } from '../hooks/useConversation'

const linkButton = 'text-[11.5px] text-fog underline decoration-seam underline-offset-[3px] hover:text-chalk disabled:opacity-50'

/** An existing GitHub review thread; resolved threads start collapsed. Replies and resolving go to GitHub right away. */
export function ThreadCard({ thread, compact }: { thread: ReviewThread; compact?: boolean }) {
  const actions = useThreadActions()
  const [open, setOpen] = useState(!thread.resolved)
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = thread.comments[0]
  if (!first) return null
  const replies = thread.comments.length - 1
  const tags = [thread.resolved && 'Resolved', thread.outdated && 'Outdated'].filter(Boolean).join(', ')

  const run = (f: () => Promise<void>, after?: () => void) => {
    setBusy(true)
    setError(null)
    f().then(
      () => {
        setBusy(false)
        after?.()
      },
      (e: Error) => {
        setBusy(false)
        setError(e.message)
      },
    )
  }
  const send = () =>
    actions &&
    body.trim() &&
    run(
      () => actions.reply(thread.id, body.trim()),
      () => {
        setBody('')
        setReplying(false)
      },
    )
  const canToggle = actions && (thread.resolved ? thread.canUnresolve : thread.canResolve)
  const toggle = () => actions && run(() => actions.setResolved(thread.id, !thread.resolved), () => setOpen(thread.resolved))

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full truncate rounded-lg border border-seam px-3 py-1.5 text-left text-[11.5px] text-fog hover:text-chalk"
      >
        {tags} thread by {first.author}
        {replies > 0 && `, ${replies} ${replies === 1 ? 'reply' : 'replies'}`}: {first.body.split('\n')[0]}
      </button>
    )
  return (
    <div className="rounded-lg border border-seam bg-slate">
      {thread.comments.map((c, i) => (
        <div key={c.url} className={i ? 'border-t border-seam px-[11px] py-2' : 'px-[11px] py-2'}>
          <div className="mb-1 flex items-center gap-2 text-[11.5px] text-fog">
            <span className="font-medium text-chalk">{c.author}</span>
            <span>{ago(c.createdAt)}</span>
            {i === 0 && tags && <span className="text-dim">{tags}</span>}
            {i === 0 && (
              <a href={c.url} target="_blank" rel="noreferrer" className="ml-auto underline decoration-seam underline-offset-[3px] hover:text-chalk">
                Open on GitHub
              </a>
            )}
          </div>
          <p className={`whitespace-pre-wrap leading-normal ${compact ? 'line-clamp-4' : ''}`}>{c.body}</p>
        </div>
      ))}
      {replying ? (
        <div className="flex flex-col gap-2 border-t border-seam p-2">
          <textarea
            autoFocus
            value={body}
            placeholder="Reply on GitHub"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
              if (e.key === 'Escape') setReplying(false)
            }}
            className="min-h-14 resize-y bg-transparent leading-normal outline-none"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button onClick={() => setReplying(false)}>Cancel</Button>
            <Button variant="primary" onClick={send} disabled={busy || !body.trim()}>
              {busy ? 'Sending…' : 'Reply'} <Kbd>⌘↵</Kbd>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 border-t border-seam px-[11px] py-1.5">
          {actions && thread.canReply && (
            <button className={linkButton} onClick={() => setReplying(true)}>
              Reply
            </button>
          )}
          {canToggle && (
            <button className={linkButton} onClick={toggle} disabled={busy}>
              {busy ? 'Saving…' : thread.resolved ? 'Unresolve' : 'Resolve'}
            </button>
          )}
          {thread.resolved && (
            <button className={`${linkButton} ml-auto`} onClick={() => setOpen(false)}>
              Collapse
            </button>
          )}
        </div>
      )}
      {error && <p className="border-t border-seam px-[11px] py-1.5 text-[11.5px] text-coral">{error}</p>}
    </div>
  )
}
