import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { usd } from '@/lib/format'
import type { AiReview } from '@/types/generated/AiReview'
import type { Finding } from '@/types/generated/Finding'
import { findingKey, rowFor } from '../model/findings'

interface FindingsRailProps {
  review: AiReview | null
  reviewing: boolean
  agentName: string
  calls: Record<string, { kept: string } | 'dismissed'>
  scroller(): HTMLElement | null
  onKeep(f: Finding): void
  onDismiss(f: Finding): void
  onUndo(f: Finding): void
  onReveal(f: Finding): void
  onRetry(): void
}

const tone = (score: number) => (score >= 100 ? 'border-l-danger' : score >= 75 ? 'border-l-warning' : 'border-l-line-strong')

/**
 * Right column: the agent's findings as quiet cards beside the lines they're about. Cards follow the
 * page as it scrolls; a finding whose line isn't drawn right now has no card, and the list at the top
 * reaches every finding.
 */
export function FindingsRail({ review, reviewing, agentName, calls, scroller, onKeep, onDismiss, onUndo, onReveal, onRetry }: FindingsRailProps) {
  const railRef = useRef<HTMLElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [tops, setTops] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const findings = useMemo(() => review?.findings ?? [], [review])

  useLayoutEffect(() => {
    const box = scroller()
    if (!box) return
    let frame = 0
    const place = () => {
      frame = 0
      const rail = railRef.current?.getBoundingClientRect()
      if (!rail) return
      const floor0 = (headRef.current?.offsetHeight ?? 0) + 8
      const wanted = findings
        .map((f) => {
          const section = box.querySelector<HTMLElement>(`section[data-file="${CSS.escape(f.file)}"]`)
          const anchor = section && (rowFor(section, f.line) ?? (section.querySelector('diffs-container') ? null : section.querySelector('header')))
          return { key: findingKey(f), top: anchor ? anchor.getBoundingClientRect().top - rail.top - 2 : null }
        })
        .filter((x): x is { key: string; top: number } => x.top !== null && x.top > -40 && x.top < rail.height)
        .sort((a, b) => a.top - b.top)
      const next: Record<string, number> = {}
      let floor = floor0
      for (const w of wanted) {
        const t = Math.max(w.top, floor)
        next[w.key] = t
        floor = t + (cardRefs.current.get(w.key)?.offsetHeight ?? 40) + 6
      }
      setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place)
    }
    schedule()
    box.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Diff rows appear a moment after scrolling stops; look again shortly.
    const timer = setInterval(schedule, 400)
    return () => {
      box.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      clearInterval(timer)
      cancelAnimationFrame(frame)
    }
  }, [findings, scroller, open])

  const highlight = (f: Finding, on: boolean) => {
    const section = scroller()?.querySelector(`section[data-file="${CSS.escape(f.file)}"]`)
    const row = section && rowFor(section, f.line)
    if (row) row.toggleAttribute('data-grain-hl', on)
  }

  const toCheck = findings.filter((f) => !calls[findingKey(f)]).length
  const skill = "Grain's review skill"

  return (
    <aside ref={railRef} aria-label="Second opinion" className="relative min-h-0 overflow-hidden border-l border-line bg-surface/40 [grid-area:rail]">
      <div ref={headRef} className="relative z-10 border-b border-line bg-canvas px-3 py-2.5 text-xs">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg-muted">
          <span className="rounded-sm border border-accent/40 px-1 text-2xs font-semibold text-accent">AI</span>
          Second opinion
        </p>
        {reviewing && !review && <p className="mt-1 text-fg-subtle">{agentName} is reviewing this PR with {skill}. This takes a few minutes; keep reading.</p>}
        {review?.error && (
          <p className="mt-1 text-danger">
            Couldn't finish: <span className="text-fg-subtle">{review.error.slice(0, 200)}</span>{' '}
            <LinkButton onClick={onRetry}>Try again</LinkButton>
          </p>
        )}
        {review?.paused && (
          <p className="mt-1 text-fg-subtle">
            Not started: {review.paused}{' '}
            <LinkButton onClick={onRetry}>Review it</LinkButton>
          </p>
        )}
        {review && !review.error && !review.paused && (
          <>
            <p className="mt-1 text-fg-subtle">
              {findings.length ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} · ${toCheck} to check` : 'Nothing found.'} {agentName}, {skill}
              {review.usage && (review.usage.priced ? `, about ${usd(review.usage.costUsd)}${review.usage.estimated ? ' (est.)' : ''}` : ', cost unknown')}
              {review.since && `; after new commits, only files changed since ${review.since.slice(0, 7)} were checked again`}. Nothing is posted unless you keep it.
            </p>
            {findings.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <LinkButton onClick={() => setListOpen((o) => !o)}>{listOpen ? 'Hide list' : 'All findings'}</LinkButton>
                <span className="ml-auto text-fg-faint">
                  <Kbd>n</Kbd> <Kbd>p</Kbd> next, previous
                </span>
              </div>
            )}
            {listOpen && (
              <ul className="mt-1.5 max-h-60 overflow-auto">
                {findings.map((f) => (
                  <li key={findingKey(f)}>
                    <button onClick={() => onReveal(f)} className={cn('w-full rounded-sm px-1.5 py-1 text-left hover:bg-raised', calls[findingKey(f)] && 'opacity-50')}>
                      <span className="block truncate text-fg-muted">{f.title}</span>
                      <span className="font-mono text-2xs text-fg-faint">
                        {f.file.split('/').pop()}:{f.line}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {findings.map((f) => {
        const key = findingKey(f)
        const top = tops[key]
        const call = calls[key]
        if (top === undefined) return null
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) cardRefs.current.set(key, el)
              else cardRefs.current.delete(key)
            }}
            style={{ top }}
            onMouseEnter={() => highlight(f, true)}
            onMouseLeave={() => highlight(f, false)}
            className={cn(
              'absolute right-2.5 left-2.5 rounded-md border border-l-[3px] border-line bg-surface px-2.5 py-1.5 text-sm shadow-float transition-[top] duration-150',
              call === 'dismissed' ? 'border-l-line opacity-50' : call ? 'border-l-accent' : tone(f.score),
            )}
          >
            <button className="block w-full text-left" onClick={() => setOpen((o) => (o === key ? null : key))}>
              <span className="flex items-baseline gap-1.5 text-2xs">
                <span className={cn('font-semibold tracking-wide uppercase', call ? 'text-fg-faint' : f.score >= 100 ? 'text-danger' : 'text-warning')}>
                  {call === 'dismissed' ? 'dismissed' : call ? 'your draft' : f.category}
                </span>
                <span className="truncate font-mono text-fg-faint">
                  {f.file.split('/').pop()}:{f.line}
                </span>
                {!call && <span className="ml-auto shrink-0 text-fg-faint">{f.score}</span>}
              </span>
              {call !== 'dismissed' && <span className="mt-0.5 block text-fg-muted">{f.title}</span>}
            </button>
            {open === key && call !== 'dismissed' && (
              <div className="mt-1.5 flex flex-col gap-1 text-xs text-fg-subtle">
                <p>{f.why}</p>
                <p>
                  <span className="text-fg-faint">Fix: </span>
                  {f.fix}
                </p>
                <p className="rounded-sm bg-canvas px-1.5 py-1 font-mono text-fg-muted">{f.comment}</p>
              </div>
            )}
            <div className="mt-1 flex gap-1.5">
              {call ? (
                <LinkButton className="text-xs" onClick={() => onUndo(f)}>
                  Undo
                </LinkButton>
              ) : (
                open === key && (
                  <>
                    <Button size="sm" variant="primary" onClick={() => onKeep(f)}>
                      Keep as my comment
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDismiss(f)}>
                      Dismiss
                    </Button>
                  </>
                )
              )}
            </div>
          </div>
        )
      })}
    </aside>
  )
}

