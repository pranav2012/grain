import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { post, request } from '@/lib/http'
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
}

/** Loads a prepared PR (`owner/repo/123`) and indexes its diff by file. */
export async function loadPr(id: string): Promise<LoadedPr> {
  const [review, summaries, pr, patch] = await Promise.all([
    file(id, 'review.json').then((r) => json<Review>(r)),
    file(id, 'summaries.json').then((r) => json<Record<string, Summary>>(r)),
    file(id, 'pr.json').then((r) => json<PrMeta>(r)),
    file(id, 'diff.patch').then((r) => (r.ok ? r.text() : '')),
  ])
  if (!review) throw new Error(`"${id}" hasn't been prepared yet.`)
  const files = new Map<string, FileDiffMetadata>()
  for (const p of parsePatchFiles(patch, id)) {
    for (const f of p.files) {
      files.set(f.name, f)
      if (f.prevName) files.set(f.prevName, f)
    }
  }
  return { id, review, summaries: summaries ?? {}, pr, files, blocks: new Map(review.blocks.map((b) => [b.id, b])) }
}
