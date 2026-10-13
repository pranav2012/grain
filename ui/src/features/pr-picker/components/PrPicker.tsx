import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Scrim } from '@/components/ui/Dialog'
import { SearchInput } from '@/components/ui/Field'
import { Kbd } from '@/components/ui/Kbd'
import { ListMessage, ListOption } from '@/components/ui/ListOption'
import { cn } from '@/lib/cn'
import { ago } from '@/lib/format'
import { pickFolder } from '@/lib/pick-folder'
import { formatPrRef, looksLikePath, parsePrRef } from '@/lib/pr-ref'
import type { LocalCandidate } from '@/types/generated/LocalCandidate'
import type { Inbox } from '@/types/generated/Inbox'
import type { RecentReview } from '@/types/generated/RecentReview'
import type { RepoSummary } from '@/types/generated/RepoSummary'
import type { PrSummary } from '@/types/generated/PrSummary'
import { pickerApi } from '../api'

type Tab = 'requests' | 'mine' | 'recent' | 'browse' | 'local'

const tabs: [Tab, string][] = [
  ['requests', 'Review requests'],
  ['mine', 'My pull requests'],
  ['recent', 'Recently opened'],
  ['browse', 'Browse repos'],
  ['local', 'Local changes'],
]

interface Row {
  key: string
  title: string
  meta: string
  draft?: boolean
  run(): void
}

type PrLike = Pick<PrSummary, 'repo' | 'number' | 'title' | 'author'> &
  Partial<Pick<PrSummary, 'updatedAt' | 'isDraft'>> & { localPath?: string | null }

const cache: { inbox?: Inbox; recent?: RecentReview[]; local?: LocalCandidate[] } = {}

interface PrPickerProps {
  variant: 'page' | 'dialog'
  onOpen(id: string): void
  onClose?(): void
  initialTab?: Tab
}

/** Find something to review: review requests, your own PRs, recent, any repo, a pasted link, or local changes. */
export function PrPicker({ variant, onOpen, onClose, initialTab = 'requests' }: PrPickerProps) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [inbox, setInbox] = useState<Inbox | null>(cache.inbox ?? null)
  const [recent, setRecent] = useState<RecentReview[] | null>(cache.recent ?? null)
  const [repoResult, setRepoResult] = useState<{ query: string; rows: RepoSummary[] } | null>(null)
  const [repo, setRepo] = useState<string | null>(null)
  const [pullsResult, setPullsResult] = useState<{ repo: string; rows: PrSummary[] } | null>(null)
  const [local, setLocal] = useState<LocalCandidate[] | null>(cache.local ?? null)
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
    if (tab === 'local') pickerApi.localRepos().then((v) => setLocal((cache.local = v)), (e: Error) => setError(e.message))
  }, [tab])
  useEffect(() => {
    if (!repo) return
    pickerApi.repoPulls(repo).then((rows) => setPullsResult({ repo, rows }), (e: Error) => setError(e.message))
  }, [repo])
  const repos = repoResult?.query === q ? repoResult.rows : null
  const repoPulls = repo && pullsResult?.repo === repo ? pullsResult.rows : null

  const pasted = parsePrRef(q)
  const openLocal = useCallback(
    (path: string) => pickerApi.openLocal(path).then((r) => onOpen(r.id), (e: Error) => setError(e.message)),
    [onOpen],
  )
  const chooseLocal = useCallback(
    () => pickFolder('Choose a folder to review its local changes').then((p) => (p ? openLocal(p) : undefined), (e: Error) => setError(e.message)),
    [openLocal],
  )
  const { rows, loading } = useMemo((): { rows: Row[]; loading: boolean } => {
    if (pasted) return { rows: [{ key: 'pasted', title: `Open ${formatPrRef(pasted)}`, meta: 'Pasted link', run: () => onOpen(pasted) }], loading: false }
    if (looksLikePath(q))
      return { rows: [{ key: 'path', title: `Review local changes in ${q.trim()}`, meta: 'Your branch since it left the base branch, plus uncommitted and new files', run: () => openLocal(q.trim()) }], loading: false }
    const matches = (text: string) => q.toLowerCase().split(/\s+/).every((w) => text.toLowerCase().includes(w))
    const prRows = (xs: PrLike[] | null | undefined) => ({
      rows: (xs ?? [])
        .map(
          (p): Row => ({
            key: `${p.repo}#${p.number}`,
            title: p.title,
            meta: p.localPath ? p.localPath : `${p.repo} #${p.number} by ${p.author}${p.updatedAt ? `, updated ${ago(p.updatedAt)}` : ''}`,
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
    if (tab === 'local') {
      const choose: Row = { key: 'choose', title: 'Choose a folder…', meta: 'Pick any folder on this computer', run: chooseLocal }
      const found = (local ?? [])
        .map(
            (r): Row => ({
              key: r.path,
              title: r.branch ? `${r.name} · ${r.branch}` : r.name,
              meta: `${r.path}${r.activeAt ? `, active ${ago(new Date(r.activeAt * 1000).toISOString())}` : ''}`,
              run: () => openLocal(r.path),
            }),
          )
          .filter((r) => matches(`${r.title} ${r.meta}`))
      return { rows: q ? found : [choose, ...found], loading: !local }
    }
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
  }, [pasted, tab, inbox, recent, local, repos, repo, repoPulls, q, onOpen, openLocal, chooseLocal])

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
        'flex w-[min(760px,94vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface',
        variant === 'page' ? 'max-h-[80vh]' : 'shadow-overlay motion-safe:animate-rise',
      )}
    >
      <SearchInput
        autoFocus
        value={q}
        placeholder={
          tab === 'browse' && !repo
            ? 'Search repositories, or paste a pull request link'
            : tab === 'local'
              ? 'Filter, or type a folder path like ~/code/my-app'
              : 'Filter, or paste a pull request link'
        }
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
      <div role="tablist" className="flex items-center gap-0.5 border-b border-line px-2 py-1.5">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => switchTab(t)}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-fg-subtle hover:text-fg aria-selected:bg-raised aria-selected:text-fg"
          >
            {label}
            {t === 'requests' && inbox && <span className="text-2xs text-fg-faint tabular-nums">{inbox.reviewRequests.length}</span>}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-faint">
          <Kbd>Tab</Kbd> next list
        </span>
      </div>
      {repo && (
        <button onClick={() => setRepo(null)} className="border-b border-line px-4 py-2 text-left text-fg-subtle hover:text-fg">
          ← All repositories <span className="ml-2 text-fg">{repo}</span>
        </button>
      )}
      <ul role="listbox" className="max-h-[56vh] overflow-auto p-1.5">
        {error && rows.length > 0 && <ListMessage className="text-danger">{error}</ListMessage>}
        {rows.map((r, i) => (
          <ListOption key={r.key} selected={i === sel} onMouseEnter={() => setSel(i)} onClick={r.run} className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-fg">
              {r.title}
              {r.draft && <Badge className="ml-1.5">Draft</Badge>}
            </span>
            <span className="text-xs text-fg-subtle">{r.meta}</span>
          </ListOption>
        ))}
        {loading && <ListMessage>{tab === 'local' ? 'Looking for repositories…' : 'Loading from GitHub…'}</ListMessage>}
        {!loading && rows.length === 0 && (
          <ListMessage>{error ?? (q ? 'Nothing matches. Paste a full pull request link to open any PR.' : 'Nothing here right now.')}</ListMessage>
        )}
      </ul>
    </div>
  )
  if (variant === 'page') return panel
  return <Scrim onClose={onClose}>{panel}</Scrim>
}
