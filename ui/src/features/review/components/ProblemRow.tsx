import { cn } from '@/lib/cn'
import type { Problem } from '../model/problems'

/** One error or warning shown under its line, like an editor's inline diagnostic. */
export function ProblemRow({ problem, className }: { problem: Problem; className?: string }) {
  const error = problem.severity === 'error'
  const [first, ...rest] = problem.message.split('\n')
  return (
    <div
      id={`problem-${problem.id}`}
      className={cn('flex gap-2 border-l-2 py-1 pr-3 pl-2.5 font-sans text-sm', error ? 'border-danger bg-danger/10 text-danger' : 'border-warning bg-warning/10 text-warning', className)}
    >
      <span aria-label={error ? 'Error' : 'Warning'} className="shrink-0 font-semibold">
        {error ? '✕' : '⚠'}
      </span>
      <div className="min-w-0">
        <p className="break-words text-fg">{first}</p>
        {rest.length > 0 && <p className="mt-0.5 font-mono text-xs break-words whitespace-pre-wrap text-fg-subtle">{rest.join('\n')}</p>}
        <p className="mt-0.5 text-xs text-fg-faint">
          {problem.source}
          {problem.code &&
            (problem.url ? (
              <a href={problem.url} target="_blank" rel="noreferrer" className="ml-1.5 font-mono hover:text-fg hover:underline">
                {problem.code}
              </a>
            ) : (
              <span className="ml-1.5 font-mono">{problem.code}</span>
            ))}
        </p>
      </div>
    </div>
  )
}
