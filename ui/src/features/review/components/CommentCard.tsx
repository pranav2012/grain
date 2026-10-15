import { LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { kindLabel } from '../model/modes'
import type { ReviewComment } from '../model/types'

export function CommentCard({ c, onEdit, onDelete }: { c: ReviewComment; onEdit(): void; onDelete(): void }) {
  return (
    <Card className="min-w-0 px-3 py-2 leading-normal break-words">
      <div className="mb-1 flex min-w-0 items-center gap-2 text-xs text-fg-subtle">
        <span className={cn('font-medium', (c.kind === 'change' || c.kind === 'fix') && 'text-danger', c.kind === 'question' && 'text-warning')}>
          {kindLabel[c.kind]}
        </span>
        {c.file && (
          <span className="min-w-0 truncate">
            {c.file.split('/').pop()}:{c.line}
            {c.endLine && c.endLine !== c.line ? `–${c.endLine}` : ''}
          </span>
        )}
        {c.postedAt ? (
          <span className="ml-auto shrink-0 text-success">Posted</span>
        ) : (
          <span className="ml-auto flex shrink-0 gap-3">
            <LinkButton onClick={onEdit}>Edit</LinkButton>
            <LinkButton onClick={onDelete}>Delete</LinkButton>
          </span>
        )}
      </div>
      {c.body}
      {c.suggestion !== undefined && (
        <pre className={cn('overflow-x-auto rounded-md border border-line bg-canvas p-2 font-mono text-sm', c.body && 'mt-1.5')}>
          {c.suggestion || '(delete these lines)'}
        </pre>
      )}
    </Card>
  )
}
