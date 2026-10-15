import { useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Finding } from '@/types/generated/Finding'

interface FindingNoteProps {
  finding: Finding
  onKeep(): void
  onEdit(): void
  onDismiss(): void
}

/** An AI finding under its line, waiting for the reviewer, with its reasoning one click away. */
export function FindingNote({ finding: f, onKeep, onEdit, onDismiss }: FindingNoteProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('rounded-md border border-l-[3px] border-line bg-surface px-2.5 py-1.5 text-sm', f.score >= 100 ? 'border-l-danger' : f.score >= 75 ? 'border-l-warning' : 'border-l-accent')}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-baseline gap-1.5 text-left">
        <span className="shrink-0 rounded-sm border border-accent/40 px-1 text-2xs font-semibold text-accent">AI</span>
        <span className={cn('shrink-0 text-2xs font-semibold tracking-wide uppercase', f.score >= 100 ? 'text-danger' : 'text-warning')}>{f.category}</span>
        <span className="shrink-0 text-2xs text-fg-faint">{f.score}</span>
        <span className="min-w-0 flex-1 text-fg-muted">{f.title}</span>
        <span className="shrink-0 text-2xs text-fg-faint">{open ? 'less ▴' : 'why ▾'}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1 text-xs text-fg-subtle">
          <p>{f.why}</p>
          <p>
            <span className="text-fg-faint">Fix: </span>
            {f.fix}
          </p>
          <p className="rounded-sm bg-canvas px-1.5 py-1 font-mono text-fg-muted">{f.comment}</p>
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="sm" variant="primary" onClick={onKeep}>
          Keep
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <LinkButton className="text-xs" onClick={onDismiss}>
          Dismiss
        </LinkButton>
        <span className="ml-auto text-2xs text-fg-faint">waiting for you</span>
      </div>
    </div>
  )
}
