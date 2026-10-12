import { post, put, request } from '@/lib/http'
import type { Conversation } from '@/types/generated/Conversation'
import type { LocalRepo } from '@/types/generated/LocalRepo'
import type { SubmitRequest } from '@/types/generated/SubmitRequest'
import type { SubmitResponse } from '@/types/generated/SubmitResponse'
import type { OpenResponse } from '@/types/generated/OpenResponse'
import type { Review } from '@/types/generated/Review'
import type { Status } from '@/types/generated/Status'
import type { Summary } from '@/types/generated/Summary'
import type { LoadedPr, PrMeta } from './model/types'

const file = (id: string, name: string) => fetch(`/api/reviews/${id}/files/${name}`)

async function json<T>(r: Response): Promise<T | null> {
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
  return (await r.json()) as T
}

export const reviewApi = {
  open: (pr: string) => post<OpenResponse>('/api/open', { pr }),
  status: (id: string) => request<Status>(`/api/reviews/${id}/status`),
  summaries: (id: string) => request<Record<string, Summary>>(`/api/reviews/${id}/files/summaries.json`),
  summarize: (id: string, keys: string[]) => post<null>(`/api/reviews/${id}/summarize`, { keys }),
  /** `fullRepo` is `owner/repo`. */
  localRepo: (fullRepo: string) => request<LocalRepo>(`/api/repos/${fullRepo}/local`),
  setLocalRepo: (fullRepo: string, path: string | null) => put<LocalRepo>(`/api/repos/${fullRepo}/local`, { path }),
  submit: (id: string, req: SubmitRequest) => post<SubmitResponse>(`/api/reviews/${id}/submit`, req),
  conversation: (id: string) => request<Conversation>(`/api/reviews/${id}/conversation`),
  review: (id: string) => request<Review>(`/api/reviews/${id}/files/review.json`),
  /** Unified diff sections for just these files. */
  diff: (id: string, files: string[]) =>
    fetch(`/api/reviews/${id}/diff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }) }).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(`Couldn't load the diff (${r.status})`)),
    ),
}

/** Loads a prepared PR (`owner/repo/123`). Diffs are fetched per block, never all at once. */
export async function loadPr(id: string): Promise<LoadedPr> {
  const [review, summaries, pr] = await Promise.all([
    file(id, 'review.json').then((r) => json<Review>(r)),
    file(id, 'summaries.json').then((r) => json<Record<string, Summary>>(r)),
    file(id, 'pr.json').then((r) => json<PrMeta>(r)),
  ])
  if (!review) throw new Error(`"${id}" hasn't been prepared yet.`)
  return withReview({ id, summaries: summaries ?? {}, pr }, review)
}

export function withReview(base: Pick<LoadedPr, 'id' | 'summaries' | 'pr'>, review: Review): LoadedPr {
  return { ...base, review, blocks: new Map(review.blocks.map((b) => [b.id, b])) }
}
