import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { Virtualizer } from '@pierre/diffs'
import { VirtualizerContext } from '@pierre/diffs/react'
import { Button } from '@/components/ui/Button'
import { InlineCode } from '@/components/ui/InlineCode'
import { SectionLabel } from '@/components/ui/SectionLabel'
import { chapterSummaryOf } from '../model/describe'
import type { FileChapter } from '../model/files'
import { kindLabel } from '../model/story'
import type { LoadedPr } from '../model/types'

export interface PrPageHandle {
  jump(file: string, remember?: boolean): void
  /** Jumps to `file`, then centers what `locate` finds in it once the diff has drawn it. */
  reveal(file: string, locate: (section: HTMLElement) => HTMLElement | null): void
  scroller(): HTMLElement | null
  top(): void
  back(): boolean
  canGoBack(): boolean
}

interface PrPageProps {
  ref: Ref<PrPageHandle>
  data: LoadedPr
  chapters: FileChapter[]
  overview: ReactNode
  renderFile(file: string, stuck: boolean): ReactNode
  onCurrent(file: string): void
  onBackChange(canGoBack: boolean): void
  onViewAll(files: string[]): void
}

/** The whole PR on one scrolling page: overview, then each chapter's files in reading order. */
export function PrPage({ ref, data, chapters, overview, renderFile, onCurrent, onBackChange, onViewAll }: PrPageProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [virtualizer] = useState(() => new Virtualizer())
  const [stuck, setStuck] = useState<string | null>(null)
  const backStack = useRef<number[]>([])

  // A callback ref sets the virtualizer up before the diffs inside mount, so they render only visible lines.
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      if (el) virtualizer.setup(el)
      else virtualizer.cleanUp()
    },
    [virtualizer],
  )

  const sectionOf = (file: string) => scrollRef.current?.querySelector<HTMLElement>(`section[data-file="${CSS.escape(file)}"]`)
  const scrollToEl = (el: HTMLElement) => {
    const box = scrollRef.current!
    box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop })
  }

  const jump = (file: string, remember = true) => {
    const el = sectionOf(file)
    if (!el || !scrollRef.current) return
    if (remember) {
      backStack.current.push(scrollRef.current.scrollTop)
      onBackChange(true)
    }
    scrollToEl(el)
    // Diffs above may finish measuring after the jump; settle on the file once more.
    setTimeout(() => sectionOf(file) && scrollToEl(sectionOf(file)!), 150)
  }

  useImperativeHandle(ref, () => ({
    jump,
    scroller: () => scrollRef.current,
    reveal(file, locate) {
      jump(file)
      let tries = 0
      // Only lines near the viewport are drawn, so walk down the file until the row exists.
      const look = () => {
        const box = scrollRef.current
        const section = sectionOf(file)
        const el = section && locate(section)
        if (el) return el.scrollIntoView({ block: 'center' })
        if (!box || !section || tries++ > 40 || section.getBoundingClientRect().bottom < box.getBoundingClientRect().bottom) return
        box.scrollBy({ top: box.clientHeight * 0.7 })
        setTimeout(look, 80)
      }
      setTimeout(look, 250)
    },
    top() {
      scrollRef.current?.scrollTo({ top: 0 })
    },
    back() {
      const y = backStack.current.pop()
      onBackChange(backStack.current.length > 0)
      if (y === undefined) return false
      scrollRef.current?.scrollTo({ top: y })
      return true
    },
    canGoBack: () => backStack.current.length > 0,
  }))

  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    let frame = 0
    const update = () => {
      frame = 0
      const top = box.getBoundingClientRect().top
      let cur: HTMLElement | undefined
      for (const s of box.querySelectorAll<HTMLElement>('section[data-file]')) {
        if (s.getBoundingClientRect().top <= top + 12) cur = s
        else break
      }
      if (!cur) return
      const file = cur.dataset.file!
      onCurrent(file)
      setStuck(cur.getBoundingClientRect().top < top - 1 ? file : null)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      box.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [onCurrent])

  return (
    <VirtualizerContext value={virtualizer}>
      <div ref={attach} className="min-h-0 overflow-auto [grid-area:main]">
        <div className="mx-auto max-w-[1400px] px-5 pt-5 pb-[60vh] max-md:px-3 max-sm:px-1.5 max-sm:pt-2">
          {overview}
          {chapters.map((c) => {
            const intro = chapterSummaryOf(data, c.chapter)
            const files = [...c.sections.flatMap((s) => s.files), ...c.tests]
            return (
              <div key={c.chapter.key} id={`chapter-${c.chapter.key}`} className="mt-9 first:mt-6">
                <header className="mb-3 border-b border-line pb-2.5">
                  <p className="text-2xs font-semibold tracking-wider text-accent uppercase">{kindLabel[c.chapter.kind]}</p>
                  <h2 className="text-lg font-semibold">{c.chapter.title}</h2>
                  <p className="mt-0.5 max-w-[100ch] text-sm text-fg-muted">{intro ? <InlineCode text={intro.intent} /> : c.chapter.about}</p>
                  <p className="mt-0.5 text-xs text-fg-faint">
                    {files.length - c.tests.length} files{c.tests.length > 0 && ` · ${c.tests.length} tests`}
                    {c.chapter.entry && (
                      <>
                        {' '}
                        · starts at <span className="font-mono text-fg-subtle">{c.chapter.entry}</span>
                      </>
                    )}
                    {c.chapter.kind === 'routine' && (
                      <Button size="sm" variant="ghost" className="ml-2" onClick={() => onViewAll(files)}>
                        Mark all viewed
                      </Button>
                    )}
                  </p>
                </header>
                {c.sections.map((s) => (
                  <div key={s.title || 'all'}>
                    {s.title && <SectionLabel className="mt-5 mb-2">{s.title}</SectionLabel>}
                    {s.files.map((f) => (
                      <div key={f}>{renderFile(f, stuck === f)}</div>
                    ))}
                  </div>
                ))}
                {c.tests.length > 0 && (
                  <>
                    <div className="mt-5 mb-2 flex items-center gap-3 text-xs text-fg-faint after:h-px after:flex-1 after:bg-line">
                      Tests for this chapter · {c.tests.length} {c.tests.length === 1 ? 'file' : 'files'}, collapsed
                    </div>
                    {c.tests.map((f) => (
                      <div key={f}>{renderFile(f, stuck === f)}</div>
                    ))}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </VirtualizerContext>
  )
}
