import { useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { InlineCode } from '@/components/ui/InlineCode'
import { cn } from '@/lib/cn'
import type { LineThread } from '../model/types'

interface AiThreadProps {
  thread: LineThread
  agentName: string
  onFollowUp(question: string): void
  onToggle(open: boolean): void
  onComment(body: string): void
  /** Reports where the collapsed marker is, so the page can show the conversation on hover. */
  onHover(rect: DOMRect | null): void
}

const tag = <span className="rounded-sm border border-accent/40 px-1 text-2xs font-semibold text-accent">AI</span>

/** The agent's answers at one line: an open conversation, or a small marker that shows it on hover. */
export function AiThread({ thread, agentName, onFollowUp, onToggle, onComment, onHover }: AiThreadProps) {
  const [question, setQuestion] = useState('')
  const last = thread.messages[thread.messages.length - 1]
  const thinking = !!last && !last.answer && !last.error

  if (!thread.open)
    return (
      <button
        onClick={() => onToggle(true)}
        onMouseEnter={(e) => onHover(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => onHover(null)}
        className="inline-flex max-w-[70ch] items-center gap-2 self-start rounded-full border border-accent/40 bg-surface px-2.5 py-0.5 text-xs text-fg-subtle hover:text-fg"
      >
        {tag}
        <span className="truncate">
          {thinking ? `${agentName} is thinking…` : `${thread.messages.length === 1 ? 'Answer' : `${thread.messages.length} answers`} about ${thread.about}`}
        </span>
      </button>
    )

  return (
    <div className="overflow-hidden rounded-lg border border-accent/50 bg-surface shadow-float">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-fg-subtle">
        {tag}
        <span className="truncate font-mono">{thread.about}</span>
        <LinkButton className="ml-auto" onClick={() => onToggle(false)}>
          Collapse
        </LinkButton>
      </div>
      <ThreadMessages thread={thread} agentName={agentName} onComment={onComment} />
      <form
        className="flex gap-2 border-t border-line px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (question.trim()) onFollowUp(question.trim())
          setQuestion('')
        }}
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') onToggle(false)
          }}
          placeholder="Ask a follow-up…"
          className="min-w-0 flex-1 py-1 text-sm"
          disabled={thinking}
        />
        <Button size="sm" type="submit" disabled={thinking || !question.trim()}>
          Ask
        </Button>
      </form>
      <p className="px-3 pb-2 text-2xs text-fg-faint">{agentName} explains; you decide. Nothing is posted unless you turn it into a comment.</p>
    </div>
  )
}

/** Questions and answers, oldest first. */
export function ThreadMessages({ thread, agentName, onComment }: { thread: LineThread; agentName: string; onComment?(body: string): void }) {
  return (
    <ol className="flex flex-col gap-2 px-3 py-2 text-sm">
      {thread.messages.map((m) => (
        <li key={m.id}>
          <p className="text-fg-subtle">{m.question}</p>
          <p className={cn('mt-0.5 leading-relaxed', m.error ? 'text-danger' : 'text-fg-muted')}>
            {m.error ?? (m.answer ? <InlineCode text={m.answer} /> : `${agentName} is thinking…`)}
          </p>
          {m.answer && onComment && (
            <LinkButton className="mt-0.5" onClick={() => onComment(m.answer!)}>
              turn into comment
            </LinkButton>
          )}
        </li>
      ))}
    </ol>
  )
}
