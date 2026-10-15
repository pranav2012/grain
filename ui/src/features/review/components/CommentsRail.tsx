import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { ago, usd } from '@/lib/format'
import type { AiReview } from '@/types/generated/AiReview'
import type { Finding } from '@/types/generated/Finding'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { findingKey, rowFor } from '../model/findings'
import type { ReviewComment, Side } from '../model/types'

type Kind = 'github' | 'ai' | 'mine'
type Call = { kept: string } | 'dismissed'

interface CommentsRailProps {
  /** The agent's review; `undefined` when AI is off. */
  review: AiReview | null | undefined
  reviewing: boolean
  agentName: string
  calls: Record<string, Call>
  threads: ReviewThread[]
  comments: ReviewComment[]
  scroller(): HTMLElement | null
  onKeep(f: Finding): void
  onDismiss(f: Finding): void
  onUndo(f: Finding): void
  onReveal(file: string, line: number | null, side: Side): void
  onRetry(): void
}

interface Item {
  key: string
  kind: Kind
  file: string
  line: number | null
  side: Side
  finding?: Finding
  thread?: ReviewThread
  comment?: ReviewComment
}

const LABEL: Record<Kind, string> = { github: 'On GitHub', ai: 'AI', mine: 'My drafts' }
const fileName = (p: string) => p.split('/').pop()!
/** A comment's markdown as short plain text: no code blocks, collapsed sections, tags or emphasis. */
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<details>[\s\S]*?<\/details>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The drawn row for a line, or the file's header when the comment has no line. */
function anchorFor(section: Element, line: number | null, side: Side): HTMLElement | null {
  if (line !== null) return rowFor(section, line, side) ?? (section.querySelector('diffs-container') ? null : section.querySelector('header'))
  return section.querySelector('header')
}

const aiTone = (score: number) => (score >= 100 ? 'border-l-danger' : score >= 75 ? 'border-l-warning' : 'border-l-accent')

/** Right column: GitHub threads, AI findings and the reviewer's drafts, each styled apart, beside their lines. */
export function CommentsRail({ review, reviewing, agentName, calls, threads, comments, scroller, onKeep, onDismiss, onUndo, onReveal, onRetry }: CommentsRailProps) {
  const railRef = useRef<HTMLElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [tops, setTops] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [hidden, setHidden] = useState<Partial<Record<Kind, boolean>>>({})
  const findings = useMemo(() => review?.findings ?? [], [review])
  const aiOn = review !== undefined

  // A kept finding is shown as the draft it became, unless that draft was deleted.
  const draftIds = useMemo(() => new Set(comments.map((c) => c.id)), [comments])
  const callOf = (f: Finding): Call | undefined => {
    const call = calls[findingKey(f)]
    return call && call !== 'dismissed' && !draftIds.has(call.kept) ? undefined : call
  }
  const fromAi = useMemo(() => new Set(Object.values(calls).flatMap((c) => (c === 'dismissed' ? [] : [c.kept]))), [calls])

  const all = useMemo<Item[]>(
    () => [
      ...threads.map((t): Item => ({ key: `gh:${t.id}`, kind: 'github', file: t.path, line: t.outdated ? null : t.line, side: t.side === 'LEFT' ? 'deletions' : 'additions', thread: t })),
      ...findings
        .filter((f) => {
          const call = calls[findingKey(f)]
          return !call || call === 'dismissed' || !draftIds.has(call.kept)
        })
        .map((f): Item => ({ key: `ai:${findingKey(f)}`, kind: 'ai', file: f.file, line: f.line, side: 'additions', finding: f })),
      ...comments
        .filter((c) => c.file && !c.postedAt)
        .map((c): Item => ({ key: `me:${c.id}`, kind: 'mine', file: c.file!, line: c.line ? (c.endLine ?? c.line) : null, side: c.side ?? 'additions', comment: c })),
    ],
    [threads, findings, comments, calls, draftIds],
  )
  const count = (k: Kind) => all.filter((i) => i.kind === k).length
  const items = useMemo(() => all.filter((i) => !hidden[i.kind]), [all, hidden])

  useLayoutEffect(() => {
    const box = scroller()
    if (!box) return
    let frame = 0
    const place = () => {
      frame = 0
      const rail = railRef.current?.getBoundingClientRect()
      if (!rail) return
      const wanted = items
        .map((it) => {
          const section = box.querySelector<HTMLElement>(`section[data-file="${CSS.escape(it.file)}"]`)
          const anchor = section && anchorFor(section, it.line, it.side)
          return { key: it.key, top: anchor ? anchor.getBoundingClientRect().top - rail.top - 2 : null }
        })
        .filter((x): x is { key: string; top: number } => x.top !== null && x.top > -40 && x.top < rail.height)
        .sort((a, b) => a.top - b.top)
      const next: Record<string, number> = {}
      let floor = (headRef.current?.offsetHeight ?? 0) + 8
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
      const timer = setInterval(schedule, 400)
    return () => {
      box.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      clearInterval(timer)
      cancelAnimationFrame(frame)
    }
  }, [items, scroller, open])

  const highlight = (it: Item, on: boolean) => {
    const section = scroller()?.querySelector(`section[data-file="${CSS.escape(it.file)}"]`)
    const row = section && it.line !== null && anchorFor(section, it.line, it.side)
    if (row) row.toggleAttribute('data-grain-hl', on)
  }

  const toCheck = findings.filter((f) => !callOf(f)).length
  const skill = "Grain's review skill"
  const place = (it: Item) => `${fileName(it.file)}${it.line !== null ? `:${it.line}` : ''}`

  const card = (it: Item) => {
    if (it.kind === 'github' && it.thread) {
      const t = it.thread
      const first = t.comments[0]
      const replies = t.comments.length - 1
      return (
        <button className="block w-full text-left" onClick={() => onReveal(it.file, it.line, it.side)}>
          <span className="flex items-baseline gap-1.5 text-2xs">
            <span className="font-semibold tracking-wide text-fg-muted uppercase">GitHub</span>
            <span className="truncate text-fg-subtle">@{first?.author}</span>
            <span className="ml-auto shrink-0 text-fg-faint">{t.resolved ? 'resolved' : t.outdated ? 'outdated' : ago(first?.createdAt)}</span>
          </span>
          <span className="mt-0.5 line-clamp-3 text-fg-muted">{plain(first?.body ?? '')}</span>
          <span className="mt-0.5 block font-mono text-2xs text-fg-faint">
            {place(it)}
            {replies > 0 && <span className="font-sans"> · {replies === 1 ? '1 reply' : `${replies} replies`}</span>}
          </span>
        </button>
      )
    }
    if (it.kind === 'mine' && it.comment) {
      const c = it.comment
      return (
        <button className="block w-full text-left" onClick={() => onReveal(it.file, it.line, it.side)}>
          <span className="flex items-baseline gap-1.5 text-2xs">
            <span className="font-semibold tracking-wide text-success uppercase">Draft</span>
            <span className="text-fg-subtle">not posted{fromAi.has(c.id) ? ' · from AI' : ''}</span>
            <span className="ml-auto truncate font-mono text-fg-faint">{place(it)}</span>
          </span>
          <span className="mt-0.5 line-clamp-3 text-fg-muted">{c.body}</span>
        </button>
      )
    }
    const f = it.finding!
    const call = callOf(f)
    return (
      <>
        <button className="block w-full text-left" onClick={() => setOpen((o) => (o === it.key ? null : it.key))}>
          <span className="flex items-baseline gap-1.5 text-2xs">
            <span className="rounded-sm border border-accent/40 px-1 font-semibold text-accent">AI</span>
            <span className={cn('font-semibold tracking-wide uppercase', call ? 'text-fg-faint' : f.score >= 100 ? 'text-danger' : 'text-warning')}>{call === 'dismissed' ? 'dismissed' : f.category}</span>
            <span className="truncate font-mono text-fg-faint">{place(it)}</span>
            {!call && <span className="ml-auto shrink-0 text-fg-faint">{f.score}</span>}
          </span>
          {call !== 'dismissed' && <span className="mt-0.5 block text-fg-muted">{f.title}</span>}
          {!call && open !== it.key && <span className="block text-2xs text-accent">waiting for you</span>}
        </button>
        {open === it.key && call !== 'dismissed' && (
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
            open === it.key && (
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
      </>
    )
  }

  const style = (it: Item) => {
    if (it.kind === 'github') return cn('border-l-fg-faint bg-surface', it.thread?.resolved && 'opacity-50')
    if (it.kind === 'mine') return 'border-dashed border-success/50 border-l-success bg-surface'
    const call = callOf(it.finding!)
    return cn('bg-surface', call === 'dismissed' ? 'border-l-line opacity-50' : aiTone(it.finding!.score))
  }

  return (
    <aside ref={railRef} aria-label="Comments" className="relative min-h-0 overflow-hidden border-l border-line bg-surface/40 [grid-area:rail]">
      <div ref={headRef} className="relative z-10 border-b border-line bg-canvas px-3 py-2.5 text-xs">
        <p className="flex items-center gap-1 text-sm font-medium text-fg-muted">
          Comments
          <span className="ml-auto flex gap-1">
            {(['github', 'ai', 'mine'] as const)
              .filter((k) => k !== 'ai' || aiOn)
              .map((k) => (
                <button
                  key={k}
                  aria-pressed={!hidden[k]}
                  title={hidden[k] ? `Show ${LABEL[k]}` : `Hide ${LABEL[k]}`}
                  onClick={() => setHidden((h) => ({ ...h, [k]: !h[k] }))}
                  className={cn(
                    'rounded-sm border px-1.5 text-2xs',
                    hidden[k] ? 'border-line text-fg-faint line-through' : k === 'ai' ? 'border-accent/40 text-accent' : k === 'mine' ? 'border-dashed border-success/50 text-success' : 'border-line-strong text-fg-muted',
                  )}
                >
                  {k === 'github' ? 'GitHub' : k === 'ai' ? 'AI' : 'Mine'} {count(k)}
                </button>
              ))}
          </span>
        </p>
        {aiOn && reviewing && !review && <p className="mt-1 text-fg-subtle">{agentName} is reviewing this PR with {skill}. This takes a few minutes; keep reading.</p>}
        {review?.error && (
          <p className="mt-1 text-danger">
            Couldn't finish: <span className="text-fg-subtle">{review.error.slice(0, 200)}</span> <LinkButton onClick={onRetry}>Try again</LinkButton>
          </p>
        )}
        {review?.paused && (
          <p className="mt-1 text-fg-subtle">
            AI not started: {review.paused} <LinkButton onClick={onRetry}>Review it</LinkButton>
          </p>
        )}
        {review && !review.error && !review.paused && (
          <>
            <p className="mt-1 text-fg-subtle">
              AI: {findings.length ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} · ${toCheck} waiting for you` : 'nothing found.'} {agentName}, {skill}
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
                    <button onClick={() => onReveal(f.file, f.line, 'additions')} className={cn('w-full rounded-sm px-1.5 py-1 text-left hover:bg-raised', callOf(f) && 'opacity-50')}>
                      <span className="block truncate text-fg-muted">{f.title}</span>
                      <span className="font-mono text-2xs text-fg-faint">
                        {fileName(f.file)}:{f.line}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {all.length === 0 && !aiOn && <p className="mt-1 text-fg-subtle">No comments yet.</p>}
      </div>
      {items.map((it) => {
        const top = tops[it.key]
        if (top === undefined) return null
        return (
          <div
            key={it.key}
            ref={(el) => {
              if (el) cardRefs.current.set(it.key, el)
              else cardRefs.current.delete(it.key)
            }}
            style={{ top }}
            onMouseEnter={() => highlight(it, true)}
            onMouseLeave={() => highlight(it, false)}
            className={cn('absolute right-2.5 left-2.5 rounded-md border border-l-[3px] border-line px-2.5 py-1.5 text-sm shadow-float transition-[top] duration-150', style(it))}
          >
            {card(it)}
          </div>
        )
      })}
    </aside>
  )
}
