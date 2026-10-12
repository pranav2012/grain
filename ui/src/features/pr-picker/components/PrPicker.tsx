import { useEffect, useMemo, useState } from 'react'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import { ago } from '@/lib/format'
import { formatPrRef, parsePrRef } from '@/lib/pr-ref'
import type { Inbox } from '@/types/generated/Inbox'
import type { RecentReview } from '@/types/generated/RecentReview'
import type { RepoSummary } from '@/types/generated/RepoSummary'
import type { PrSummary } from '@/types/generated/PrSummary'
import { pickerApi } from '../api'

type Tab = 'requests' | 'mine' | 'recent' | 'browse'

const tabs: [Tab, string][] = [
  ['requests', 'Review requests'],
  ['mine', 'My pull requests'],
  ['recent', 'Recently opened'],
  ['browse', 'Browse repos'],
]

interface Row {
  key: string
  title: string
  meta: string
  draft?: boolean
  run(): void
}

type PrLike = Pick<PrSummary, 'repo' | 'number' | 'title' | 'author'> & Partial<Pick<PrSummary, 'updatedAt' | 'isDraft'>>

const cache: { inbox?: Inbox; recent?: RecentReview[] } = {}

interface PrPickerProps {
  variant: 'page' | 'dialog'
  onOpen(id: string): void
  onClose?(): void
}

/** Find a pull request: review requests, your own, recent, any repo, or a pasted link. */
export function PrPicker({ variant, onOpen, onClose }: PrPickerProps) {
  const [tab, setTab] = useState<Tab>('requests')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [inbox, setInbox] = useState<Inbox | null>(cache.inbox ?? null)
  const [recent, setRecent] = useState<RecentReview[] | null>(cache.recent ?? null)
  const [repoResult, setRepoResult] = useState<{ query: string; rows: RepoSummary[] } | null>(null)
  const [repo, setRepo] = useState<string | null>(null)
  const [pullsResult, setPullsResult] = useState<{ repo: string; rows: PrSummary[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    pickerApi.inbox().then((v) => setInbox((cache.inbox = v)), (e: Error) => setError(e.message))
    pickerApi.recent().then((v) => setRecent((cache.recent = v)), () => setRecent([]))
  }, [])
  useEffect(() => {
    if (tab !== 'browse' || repo) return
    const query = q
    const t = setTimeout(
      () => pickerApi.repos(query).then((rows) => setRepoResult({ query, rows }), (e: Error) => setError(e.message)),
      query ? 300 : 0,
    )
    return () => clearTimeout(t)
  }, [tab, repo, q])
  useEffect(() => {
    if (!repo) return
    pickerApi.repoPulls(repo).then((rows) => setPullsResult({ repo, rows }), (e: Error) => setError(e.message))
  }, [repo])
  const repos = repoResult?.query === q ? repoResult.rows : null
  const repoPulls = repo && pullsResult?.repo === repo ? pullsResult.rows : null

  const pasted = parsePrRef(q)
  const { rows, loading } = useMemo((): { rows: Row[]; loading: boolean } => {
    if (pasted) return { rows: [{ key: 'pasted', title: `Open ${formatPrRef(pasted)}`, meta: 'Pasted link', run: () => onOpen(pasted) }], loading: false }
    const matches = (text: string) => q.toLowerCase().split(/\s+/).every((w) => text.toLowerCase().includes(w))
    const prRows = (xs: PrLike[] | null | undefined) => ({
      rows: (xs ?? [])
        .map(
          (p): Row => ({
            key: `${p.repo}#${p.number}`,
            title: p.title,
            meta: `${p.repo} #${p.number} by ${p.author}${p.updatedAt ? `, updated ${ago(p.updatedAt)}` : ''}`,
            draft: p.isDraft,
            run: () => onOpen(`${p.repo}/${p.number}`),
          }),
        )
        .filter((r) => matches(`${r.title} ${r.meta}`)),
      loading: !xs,
    })
    if (tab === 'requests') return prRows(inbox?.reviewRequests)
    if (tab === 'mine') return prRows(inbox?.mine)
    if (tab === 'recent') return prRows(recent)
    if (repo) return prRows(repoPulls)
    return {
      rows: (repos ?? []).map((r) => ({
        key: r.fullName,
        title: r.fullName,
        meta: r.description || 'No description',
        run: () => {
          setRepo(r.fullName)
          setQ('')
          setSel(0)
        },
      })),
      loading: !repos,
    }
  }, [pasted, tab, inbox, recent, repos, repo, repoPulls, q, onOpen])

  const switchTab = (t: Tab) => {
    setTab(t)
    setRepo(null)
    setSel(0)
  }

  const panel = (
    <div
      role="dialog"
      aria-label="Open a pull request"
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        'flex w-[min(760px,94vw)] flex-col overflow-hidden rounded-xl border border-seam bg-slate',
        variant === 'page' ? 'max-h-[80vh]' : 'shadow-[0_24px_80px_rgba(0,0,0,0.55)] motion-safe:animate-rise',
      )}
    >
      <input
        autoFocus
        value={q}
        placeholder={tab === 'browse' && !repo ? 'Search repositories, or paste a pull request link' : 'Filter, or paste a pull request link'}
        className="w-full border-b border-seam bg-transparent px-4 py-3.5 text-[15px] outline-none"
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            if (repo) setRepo(null)
            else onClose?.()
          }
          if (e.key === 'ArrowDown') setSel((s) => Math.min(rows.length - 1, s + 1))
          if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1))
          if (e.key === 'Enter') rows[sel]?.run()
          if (e.key === 'Tab') {
            e.preventDefault()
            const i = tabs.findIndex(([t]) => t === tab)
            switchTab(tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length][0])
          }
        }}
      />
      <div role="tablist" className="flex items-center gap-0.5 border-b border-seam px-2 py-1.5">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => switchTab(t)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-[5px] text-fog aria-selected:bg-slate-2 aria-selected:text-chalk"
          >
            {label}
            {t === 'requests' && inbox && <span className="text-[11px] text-dim tabular-nums">{inbox.reviewRequests.length}</span>}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-dim">
          <Kbd>Tab</Kbd> next list
        </span>
      </div>
      {repo && (
        <button onClick={() => setRepo(null)} className="border-b border-seam px-4 py-2 text-left text-fog">
          ← All repositories <span className="ml-2 text-chalk">{repo}</span>
        </button>
      )}
      <ul role="listbox" className="max-h-[56vh] overflow-auto p-1.5">
        {rows.map((r, i) => (
          <li
            key={r.key}
            role="option"
            aria-selected={i === sel}
            onMouseEnter={() => setSel(i)}
            onClick={r.run}
            className="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-[7px] px-2.5 py-2 aria-selected:bg-slate-2"
          >
            <span className="truncate text-chalk">
              {r.title}
              {r.draft && <span className="ml-1.5 rounded border border-seam px-1.5 text-[11px] text-fog">Draft</span>}
            </span>
            <span className="text-xs text-fog">{r.meta}</span>
          </li>
        ))}
        {loading && <li className="px-2.5 py-2 text-fog">Loading from GitHub…</li>}
        {!loading && rows.length === 0 && (
          <li className="px-2.5 py-2 text-fog">
            {error ?? (q ? 'Nothing matches. Paste a full pull request link to open any PR.' : 'Nothing here right now.')}
          </li>
        )}
      </ul>
    </div>
  )
  if (variant === 'page') return panel
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center bg-[rgba(8,9,12,0.6)] pt-[12vh]" onMouseDown={onClose}>
      {panel}
    </div>
  )
}
