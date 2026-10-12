import { useEffect, useMemo, useState } from 'react'
import { api, parsePrRef, type PrListItem, type RepoItem } from '../api'

type Tab = 'requests' | 'mine' | 'recent' | 'browse'

const tabs: [Tab, string][] = [
  ['requests', 'Review requests'],
  ['mine', 'My pull requests'],
  ['recent', 'Recently opened'],
  ['browse', 'Browse repos'],
]

function ago(iso?: string): string {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(m, 1)} min ago`
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

interface Row {
  key: string
  title: string
  meta: string
  draft?: boolean
  run(): void
}

interface Props {
  asPage?: boolean
  onOpen(id: string): void
  onClose?(): void
}

const cache: { inbox?: { reviewRequests: PrListItem[]; mine: PrListItem[] }; recent?: PrListItem[] } = {}

/** Find a pull request: review requests, your own, recent, any repo, or a pasted link. */
export function Switcher({ asPage, onOpen, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('requests')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [inbox, setInbox] = useState<{ reviewRequests: PrListItem[]; mine: PrListItem[] } | null>(cache.inbox ?? null)
  const [recent, setRecent] = useState<PrListItem[] | null>(cache.recent ?? null)
  const [repos, setRepos] = useState<RepoItem[] | null>(null)
  const [repo, setRepo] = useState<string | null>(null)
  const [repoPulls, setRepoPulls] = useState<PrListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.inbox().then((v) => setInbox((cache.inbox = v)), (e: Error) => setError(e.message))
    api.recent().then((v) => setRecent((cache.recent = v)), () => setRecent([]))
  }, [])
  useEffect(() => {
    if (tab !== 'browse' || repo) return
    setRepos(null)
    const t = setTimeout(() => api.repos(q).then(setRepos, (e: Error) => setError(e.message)), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [tab, repo, q])
  useEffect(() => {
    if (!repo) return
    setRepoPulls(null)
    api.repoPulls(repo).then(setRepoPulls, (e: Error) => setError(e.message))
  }, [repo])

  const pasted = parsePrRef(q)
  const prRow = (p: PrListItem): Row => ({
    key: `${p.repo}#${p.number}`,
    title: p.title,
    meta: `${p.repo} #${p.number} by ${p.author}${p.updatedAt ? `, updated ${ago(p.updatedAt)}` : ''}`,
    draft: p.isDraft,
    run: () => onOpen(`${p.repo}/${p.number}`),
  })
  const matches = (text: string) => q.toLowerCase().split(/\s+/).every((w) => text.toLowerCase().includes(w))

  const { rows, loading } = useMemo((): { rows: Row[]; loading: boolean } => {
    if (pasted) return { rows: [{ key: 'pasted', title: `Open ${pasted.replace(/\/(\d+)$/, '#$1')}`, meta: 'Pasted link', run: () => onOpen(pasted) }], loading: false }
    const filterPrs = (xs: PrListItem[] | null | undefined) => ({ rows: (xs ?? []).map(prRow).filter((r) => matches(`${r.title} ${r.meta}`)), loading: !xs })
    if (tab === 'requests') return filterPrs(inbox?.reviewRequests)
    if (tab === 'mine') return filterPrs(inbox?.mine)
    if (tab === 'recent') return filterPrs(recent)
    if (repo) return filterPrs(repoPulls)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted, tab, inbox, recent, repos, repo, repoPulls, q])

  const switchTab = (t: Tab) => {
    setTab(t)
    setRepo(null)
    setSel(0)
  }

  const body = (
    <div className={asPage ? 'switcher page' : 'palette switcher'} role="dialog" aria-label="Open a pull request" onMouseDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={q}
        placeholder={tab === 'browse' && !repo ? 'Search repositories, or paste a pull request link' : 'Filter, or paste a pull request link'}
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
      <div className="tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}>
            {label}
            {t === 'requests' && inbox ? <span className="count">{inbox.reviewRequests.length}</span> : null}
          </button>
        ))}
        <span className="hint">
          <kbd>Tab</kbd> next list
        </span>
      </div>
      {repo && (
        <button className="crumb-back" onClick={() => setRepo(null)}>
          ← All repositories <span>{repo}</span>
        </button>
      )}
      <ul role="listbox">
        {rows.map((r, i) => (
          <li key={r.key} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={r.run}>
            <span className="pr-row">
              <span className="pr-row-title">
                {r.title} {r.draft && <span className="draft">Draft</span>}
              </span>
              <span className="pr-row-meta">{r.meta}</span>
            </span>
          </li>
        ))}
        {loading && <li className="muted-row">Loading from GitHub…</li>}
        {!loading && rows.length === 0 && (
          <li className="muted-row">{error ?? (q ? 'Nothing matches. Paste a full pull request link to open any PR.' : 'Nothing here right now.')}</li>
        )}
      </ul>
    </div>
  )
  if (asPage) return <div className="home">{body}</div>
  return (
    <div className="scrim" onMouseDown={onClose}>
      {body}
    </div>
  )
}
