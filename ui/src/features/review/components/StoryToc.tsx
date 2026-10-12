import { useEffect, useRef } from 'react'
import { Progress } from '@/components/ui/Progress'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { cn } from '@/lib/cn'
import type { Chapter } from '@/types/generated/Chapter'
import { blockTitle } from '../model/describe'
import { chapterBlocks, linesOf, progressOf, type ProgressState } from '../model/story'
import type { BlockState, LoadedPr } from '../model/types'
import { StatusIcon } from './StatusIcon'

interface StoryTocProps {
  data: LoadedPr
  chapters: Chapter[]
  current: Chapter
  currentBlock: number
  states: Record<number, BlockState>
  stale: Record<number, string>
  onChapter(c: Chapter): void
  onBlock(id: number): void
}

const row =
  'w-full rounded-md border-l-2 border-transparent px-2.5 py-1.5 text-left text-fg-subtle hover:bg-surface hover:text-fg aria-[current=true]:border-accent aria-[current=true]:bg-raised aria-[current=true]:text-fg'
const tone: Record<ProgressState, string> = { done: 'text-success', change: 'text-danger', started: '', todo: '' }

/** Left column: every chapter with its progress; the open chapter lists its sections and changes. */
export function StoryToc({ data, chapters, current, currentBlock, states, stale, onChapter, onBlock }: StoryTocProps) {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentBlock])
  const all = chapters.flatMap(chapterBlocks)
  const done = all.filter((id) => states[id]).length
  const firstOther = chapters.findIndex((c) => c.kind !== 'flow' && c.kind !== 'screens')

  return (
    <nav aria-label="Chapters" className="flex min-h-0 flex-col border-r border-line [grid-area:toc]">
      <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
        <SectionLabel className="mb-1 px-2.5">{data.review.story.flows ? 'User flows' : 'Areas'}</SectionLabel>
        {!data.review.story.flows && !data.review.complete && (
          <p className="px-2.5 pb-2 text-xs text-fg-faint">User flows appear once Grain has read the whole repository.</p>
        )}
        {chapters.map((c, i) => {
          const ids = chapterBlocks(c)
          const st = progressOf(ids, states)
          const open = c.key === current.key
          return (
            <div key={c.key}>
              {i === firstOther && i > 0 && <SectionLabel className="mt-4 mb-1 px-2.5">Everything else</SectionLabel>}
              <button className={row} aria-current={open} onClick={() => onChapter(c)} title={c.entry ?? c.about}>
                <span className={cn('block truncate', tone[st])}>
                  {st === 'done' && '✓ '}
                  {c.title}
                </span>
                <span className="block text-xs text-fg-faint tabular-nums">
                  {ids.filter((id) => states[id]).length}/{ids.length} changes · {linesOf(data, ids)} lines
                </span>
              </button>
              {open && (
                <ul className="mb-2 ml-3 border-l border-line">
                  {c.sections.map((s) => (
                    <li key={s.title || 'all'}>
                      {s.title && c.sections.length > 1 && <p className="truncate px-2.5 pt-1.5 text-xs font-medium text-fg-muted">{s.title}</p>}
                      {s.blocks.map((id) => (
                        <button
                          key={id}
                          ref={id === currentBlock ? currentRef : undefined}
                          aria-current={id === currentBlock}
                          onClick={() => onBlock(id)}
                          className="flex w-full items-center gap-2 px-2.5 py-0.5 text-left text-sm text-fg-subtle hover:text-fg aria-[current=true]:text-fg"
                        >
                          <StatusIcon state={states[id]} current={id === currentBlock} stale={!!stale[id]} />
                          <span className="truncate">{blockTitle(data, data.blocks.get(id)!)}</span>
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-line px-4.5 py-3">
        <Progress ok={done / Math.max(all.length, 1)} />
        <p className="mt-1.5 text-xs text-fg-faint">
          {done} of {all.length} changes reviewed
        </p>
      </div>
    </nav>
  )
}
