import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileOptions } from '@pierre/diffs'
import { File } from '@pierre/diffs/react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import type { NavigateResponse } from '@/types/generated/NavigateResponse'
import { reviewApi } from '../api'
import { isNewSide } from '../model/findings'

/** A place to show: a line, or the first whole-word use of `find` when the line isn't known. */
export interface CodeLocation {
  file: string
  line?: number
  find?: string
}

interface CodeModalProps {
  prId: string
  start: CodeLocation
  changedLines(file: string): Set<number> | null
  githubUrl?: (file: string, line: number) => string
  onGoToReview(file: string, line: number): void
  onClose(): void
}

const sources = new Map<string, Promise<string>>()
const load = (prId: string, file: string) => {
  const key = `${prId}:${file}`
  let p = sources.get(key)
  if (!p) {
    p = reviewApi.source(prId, file)
    p.catch(() => sources.delete(key))
    sources.set(key, p)
  }
  return p
}

const changedCSS = `[data-grain-changed] { background: color-mix(in srgb, var(--color-success) 12%, transparent); }
[data-grain-target] { outline: 1px solid var(--color-accent); outline-offset: -1px; }`

const fileName = (p: string) => p.split('/').pop()!
const dirName = (p: string) => p.split('/').slice(0, -1).join('/')

/**
 * A whole file at the PR's head, opened at a reference. ⌘-click a name to go to its definition,
 * ⇧⌘-click for its references; Back walks the trail. Files of this PR show their changed lines.
 */
export function CodeModal({ prId, start, changedLines, githubUrl, onGoToReview, onClose }: CodeModalProps) {
  const [trail, setTrail] = useState<CodeLocation[]>([start])
  const here = trail[trail.length - 1]
  const [text, setText] = useState<{ file: string; contents: string } | null>(null)
  const [failed, setFailed] = useState<{ file: string; message: string } | null>(null)
  const [refs, setRefs] = useState<{ name: string; result?: NavigateResponse; error?: string } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    load(prId, here.file).then(
      (contents) => alive && setText({ file: here.file, contents }),
      (e: Error) => alive && setFailed({ file: here.file, message: e.message }),
    )
    return () => {
      alive = false
    }
  }, [prId, here.file])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = text?.file === here.file ? text : null
  const error = failed?.file === here.file ? failed.message : null
  const changed = changedLines(here.file)
  // Without a line, land on a real use of the name: not an import, and on a changed line when there is one.
  const line = useMemo(() => {
    if (here.line) return here.line
    if (!shown || !here.find) return 1
    const word = new RegExp(`\\b${here.find.replace(/[$]/g, '\\$')}\\b`)
    const uses = shown.contents
      .split('\n')
      .map((text, i) => ({ text, n: i + 1 }))
      .filter((l) => word.test(l.text) && !/^\s*(import\b|export\s+(type\s+)?\{[^}]*\}\s+from\b|\}?\s*from\s+['"])/.test(l.text))
    return (uses.find((l) => changed?.has(l.n)) ?? uses[0])?.n ?? 1
  }, [here, shown, changed])

  const go = (loc: CodeLocation) => {
    setRefs(null)
    setTrail((t) => [...t, loc])
  }
  const goRef = useRef(go)
  const stateRef = useRef({ file: here.file, changed, line })
  useLayoutEffect(() => {
    goRef.current = go
    stateRef.current = { file: here.file, changed, line }
  })

  const options = useMemo<FileOptions<undefined, undefined>>(
    () => ({
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'dark',
      disableFileHeader: true,
      lineHoverHighlight: 'number',
      unsafeCSS: `* { --diffs-dark-bg: var(--color-canvas) !important; }\n${changedCSS}`,
      onPostRender: (node) => {
        const root = node.shadowRoot ?? node
        const { changed: lines, line: target } = stateRef.current
        for (const row of root.querySelectorAll<HTMLElement>('[data-line]')) {
          const n = Number(row.dataset.line)
          row.toggleAttribute('data-grain-changed', !!lines?.has(n))
          row.toggleAttribute('data-grain-target', n === target)
        }
      },
      onTokenClick: (t, e) => {
        if (!(e.metaKey || e.ctrlKey) || !/^[A-Za-z_$][\w$]*$/.test(t.tokenText)) return
        e.preventDefault()
        const { file } = stateRef.current
        const references = e.shiftKey
        if (references) setRefs({ name: t.tokenText })
        reviewApi.navigate(prId, { file, line: t.lineNumber, character: t.lineCharStart, name: t.tokenText, references }).then(
          (result) => {
            if (references) return setRefs({ name: t.tokenText, result })
            const first = result.results[0]
            if (result.results.length === 1 && first) goRef.current({ file: first.file, line: first.line })
            else setRefs({ name: t.tokenText, result })
          },
          (err: Error) => setRefs({ name: t.tokenText, error: err.message }),
        )
      },
    }),
    [prId],
  )

  useEffect(() => {
    if (!shown) return
    let tries = 0
    const look = () => {
      const host = bodyRef.current?.querySelector('diffs-container')
      const row = [...(host?.shadowRoot?.querySelectorAll<HTMLElement>(`[data-line="${line}"]`) ?? [])].find(isNewSide) ?? host?.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`)
      if (row) row.scrollIntoView({ block: 'center' })
      else if (tries++ < 30) setTimeout(look, 60)
    }
    look()
  }, [shown, line])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={`${here.file}:${line}`}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[86vh] w-[min(1200px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-overlay max-md:h-dvh max-md:w-full max-md:rounded-none max-md:border-0"
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
          {trail.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => (setRefs(null), setTrail((t) => t.slice(0, -1)))}>
              ← Back
            </Button>
          )}
          <span className="min-w-0 truncate font-mono text-xs" title={here.file}>
            <span className="text-fg-faint">{dirName(here.file)}/</span>
            <span className="font-semibold text-fg">{fileName(here.file)}</span>
            <span className="text-fg-faint">:{line}</span>
          </span>
          {changed && <span className="shrink-0 rounded-sm border border-success/40 px-1.5 text-2xs text-success">changed in this PR</span>}
          <span className="ml-auto flex shrink-0 items-center gap-3 text-xs">
            <span className="text-fg-faint max-[900px]:hidden">
              <Kbd>⌘</Kbd> click: definition · <Kbd>⇧⌘</Kbd> click: references
            </span>
            {changed && <LinkButton onClick={() => onGoToReview(here.file, line)}>Go to it in the review →</LinkButton>}
            {githubUrl && (
              <a href={githubUrl(here.file, line)} target="_blank" rel="noreferrer" className="text-fg-subtle hover:text-fg">
                GitHub ↗
              </a>
            )}
            <LinkButton onClick={onClose}>Close</LinkButton>
          </span>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div ref={bodyRef} className="min-w-0 flex-1 overflow-auto">
            {error && <p className="p-4 text-danger">{error}</p>}
            {!shown && !error && <p className="p-4 text-fg-faint">Opening {here.file}…</p>}
            {shown && (
              <File<undefined, undefined>
                key={here.file}
                file={{ name: here.file, contents: shown.contents, cacheKey: `${prId}:${here.file}` }}
                options={options}
                selectedLines={{ start: line, end: line }}
              />
            )}
          </div>
          {refs && (
            <aside className="flex w-80 shrink-0 flex-col border-l border-line max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:w-[min(320px,85%)] max-md:bg-surface max-md:shadow-overlay">
              <p className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-fg-subtle">
                {refs.result?.results.length === 1 ? 'Definition of' : 'Places for'} <b className="font-mono text-fg">{refs.name}</b>
                <LinkButton className="ml-auto" onClick={() => setRefs(null)}>
                  Close
                </LinkButton>
              </p>
              {!refs.result && !refs.error && <p className="px-3 py-2 text-sm text-fg-faint">Looking it up…</p>}
              {refs.error && <p className="px-3 py-2 text-sm text-danger">{refs.error}</p>}
              <ul className="min-h-0 flex-1 overflow-auto">
                {refs.result?.results.map((l) => (
                  <li key={`${l.file}:${l.line}`}>
                    <button
                      onClick={() => go({ file: l.file, line: l.line })}
                      className={cn('w-full border-b border-line px-3 py-1.5 text-left hover:bg-raised', l.file === here.file && l.line === line && 'bg-raised')}
                    >
                      <span className="block truncate font-mono text-xs text-fg-muted" title={l.file}>
                        {fileName(l.file)}:{l.line}
                      </span>
                      <span className="block truncate font-mono text-xs text-fg-faint">{(l.snippet[l.line - l.snippetStart] ?? '').trim()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
