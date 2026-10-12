import { cn } from '@/lib/cn'
import { kindLabel } from '../model/modes'
import type { ReviewComment } from '../model/types'

export function CommentCard({ c, onDelete }: { c: ReviewComment; onDelete(): void }) {
  return (
    <div className="rounded-lg border border-seam bg-slate px-[11px] py-[9px] leading-normal">
      <div className="mb-1 flex items-center gap-2 text-[11.5px] text-fog">
        <span className={cn('font-medium', (c.kind === 'change' || c.kind === 'fix') && 'text-coral', c.kind === 'question' && 'text-amber')}>
          {kindLabel[c.kind]}
        </span>
        {c.file && (
          <span>
            {c.file.split('/').pop()}:{c.line}
            {c.endLine && c.endLine !== c.line ? `–${c.endLine}` : ''}
          </span>
        )}
        <button onClick={onDelete} className="ml-auto underline decoration-seam underline-offset-[3px] hover:text-chalk">
          Delete
        </button>
      </div>
      {c.body}
    </div>
  )
}
