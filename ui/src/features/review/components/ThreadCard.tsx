import { useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Kbd } from '@/components/ui/Kbd'
import { ago } from '@/lib/format'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { useThreadActions } from '../hooks/useConversation'

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
        className="w-full truncate rounded-lg border border-line px-3 py-1.5 text-left text-xs text-fg-subtle hover:bg-surface hover:text-fg"
      >
        {tags} thread by {first.author}
        {replies > 0 && `, ${replies} ${replies === 1 ? 'reply' : 'replies'}`}: {first.body.split('\n')[0]}
      </button>
    )
  return (
    <Card>
      {thread.comments.map((c, i) => (
        <div key={c.url} className={i ? 'border-t border-line px-3 py-2' : 'px-3 py-2'}>
          <div className="mb-1 flex items-center gap-2 text-xs text-fg-subtle">
            <span className="font-medium text-fg">{c.author}</span>
            <span>{ago(c.createdAt)}</span>
            {i === 0 && tags && <span className="text-fg-faint">{tags}</span>}
            {i === 0 && (
              <a href={c.url} target="_blank" rel="noreferrer" className="ml-auto text-xs underline decoration-line underline-offset-[3px] hover:text-fg">
                Open on GitHub
              </a>
            )}
          </div>
          <p className={`whitespace-pre-wrap leading-normal ${compact ? 'line-clamp-4' : ''}`}>{c.body}</p>
        </div>
      ))}
      {replying ? (
        <div className="flex flex-col gap-2 border-t border-line p-2">
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
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5">
          {actions && thread.canReply && (
            <LinkButton onClick={() => setReplying(true)}>Reply</LinkButton>
          )}
          {canToggle && (
            <LinkButton onClick={toggle} disabled={busy}>
              {busy ? 'Saving…' : thread.resolved ? 'Unresolve' : 'Resolve'}
            </LinkButton>
          )}
          {thread.resolved && (
            <LinkButton className="ml-auto" onClick={() => setOpen(false)}>
              Collapse
            </LinkButton>
          )}
        </div>
      )}
      {error && <p className="border-t border-line px-3 py-1.5 text-xs text-danger">{error}</p>}
    </Card>
  )
}
