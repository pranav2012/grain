import { useState } from 'react'
import { ago } from '@/lib/format'
import type { ReviewThread } from '@/types/generated/ReviewThread'

/** An existing GitHub review thread; resolved threads start collapsed. */
export function ThreadCard({ thread, compact }: { thread: ReviewThread; compact?: boolean }) {
  const [open, setOpen] = useState(!thread.resolved)
  const first = thread.comments[0]
  if (!first) return null
  const replies = thread.comments.length - 1
  const tags = [thread.resolved && 'Resolved', thread.outdated && 'Outdated'].filter(Boolean).join(', ')
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
      {thread.resolved && (
        <button onClick={() => setOpen(false)} className="w-full border-t border-seam px-[11px] py-1 text-left text-[11.5px] text-dim hover:text-chalk">
          Collapse
        </button>
      )}
    </div>
  )
}
