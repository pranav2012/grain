import { post, put, request, serverFetch } from '@/lib/http'
import type { Conversation } from '@/types/generated/Conversation'
import type { LocalRepo } from '@/types/generated/LocalRepo'
import type { SubmitRequest } from '@/types/generated/SubmitRequest'
import type { SubmitResponse } from '@/types/generated/SubmitResponse'
import type { OpenResponse } from '@/types/generated/OpenResponse'
import type { Review } from '@/types/generated/Review'
import type { Status } from '@/types/generated/Status'
import type { LayerSummary } from '@/types/generated/LayerSummary'
import type { Summary } from '@/types/generated/Summary'
import type { ThreadComment } from '@/types/generated/ThreadComment'
import type { ThreadResolved } from '@/types/generated/ThreadResolved'
import type { LoadedPr, Owners, PrMeta } from './model/types'

const file = (id: string, name: string) => serverFetch(`/api/reviews/${id}/files/${name}`)

async function json<T>(r: Response): Promise<T | null> {
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
  return (await r.json()) as T
}

export const reviewApi = {
  /** `refresh` waits for new commits or local edits instead of returning the stored review. */
  open: (pr: string, refresh = false) => post<OpenResponse>('/api/open', { pr, refresh }),
  status: (id: string) => request<Status>(`/api/reviews/${id}/status`),
  summaries: (id: string) => request<Record<string, Summary | LayerSummary>>(`/api/reviews/${id}/files/summaries.json`),
  summarize: (id: string, keys: string[]) => post<null>(`/api/reviews/${id}/summarize`, { keys }),
  /** `fullRepo` is `owner/repo`. */
  localRepo: (fullRepo: string) => request<LocalRepo>(`/api/repos/${fullRepo}/local`),
  setLocalRepo: (fullRepo: string, path: string | null) => put<LocalRepo>(`/api/repos/${fullRepo}/local`, { path }),
  submit: (id: string, req: SubmitRequest) => post<SubmitResponse>(`/api/reviews/${id}/submit`, req),
  conversation: (id: string) => request<Conversation>(`/api/reviews/${id}/conversation`),
  replyToThread: (id: string, thread: string, body: string) =>
    post<ThreadComment>(`/api/reviews/${id}/threads/${thread}/replies`, { body }),
  resolveThread: (id: string, thread: string, resolved: boolean) =>
    put<ThreadResolved>(`/api/reviews/${id}/threads/${thread}/resolved`, { resolved }),
  saveProgress: (id: string, progress: unknown) => put<null>(`/api/reviews/${id}/progress`, progress),
  review: (id: string) => request<Review>(`/api/reviews/${id}/files/review.json`),
  /** Unified diff sections for just these files. */
  diff: (id: string, files: string[], since?: string) =>
    serverFetch(`/api/reviews/${id}/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files, since: since ?? null }),
    }).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(`Couldn't load the diff (${r.status})`)),
    ),
}

/** Loads a prepared PR (`owner/repo/123`). Diffs are fetched per block, never all at once. */
export async function loadPr(id: string): Promise<LoadedPr> {
  const [review, summaries, pr, progress, owners] = await Promise.all([
    file(id, 'review.json').then((r) => json<Review>(r)),
    file(id, 'summaries.json').then((r) => json<Record<string, Summary | LayerSummary>>(r)),
    file(id, 'pr.json').then((r) => json<PrMeta>(r)),
    request<unknown>(`/api/reviews/${id}/progress`).catch(() => null),
    file(id, 'owners.json').then((r) => json<Owners>(r)),
  ])
  if (!review) throw new Error(`"${id}" hasn't been prepared yet.`)
  return withReview({ id, summaries: summaries ?? {}, pr, progress, owners: owners ?? { source: null, files: {}, mine: [] } }, review)
}

export function withReview(base: Omit<LoadedPr, 'review' | 'blocks'>, review: Review): LoadedPr {
  // Reviews stored by an older Grain lack newer fields; read them as empty (or one layer) instead of crashing.
  const legacy = (): Review['layers'] => {
    const blocks = review.blocks.filter((b) => !b.skim).map((b) => b.id)
    const lines = review.blocks.filter((b) => !b.skim).reduce((n, b) => n + b.lines, 0)
    return blocks.length ? [{ id: 1, key: 'all', title: 'All changes', stage: 'Code', dir: '', lines, blocks, uses: [] }] : []
  }
  const r: Review = { ...review, links: review.links ?? [], layers: review.layers ?? legacy() }
  return { ...base, review: r, blocks: new Map(r.blocks.map((b) => [b.id, b])) }
}
