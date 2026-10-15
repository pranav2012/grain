import { post, put, request, serverFetch } from '@/lib/http'
import type { AiReview } from '@/types/generated/AiReview'
import type { AskRequest } from '@/types/generated/AskRequest'
import type { AskResponse } from '@/types/generated/AskResponse'
import type { Conversation } from '@/types/generated/Conversation'
import type { Diagnostics } from '@/types/generated/Diagnostics'
import type { PrStatus } from '@/types/generated/PrStatus'
import type { SavedConversation } from '@/types/generated/SavedConversation'
import type { SavedPrStatus } from '@/types/generated/SavedPrStatus'
import type { NavigateRequest } from '@/types/generated/NavigateRequest'
import type { NavigateResponse } from '@/types/generated/NavigateResponse'
import type { OutsideUsesFile } from '@/types/generated/OutsideUsesFile'
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
  /** Definition or references of the name at a position in the new version of a file. */
  navigate: (id: string, req: NavigateRequest) => post<NavigateResponse>(`/api/reviews/${id}/navigate`, req),
  /** One whole file at the PR's head. */
  source: (id: string, path: string, rev?: 'base') =>
    serverFetch(`/api/reviews/${id}/source?path=${encodeURIComponent(path)}${rev ? `&rev=${rev}` : ''}`).then(async (r) => {
      if (r.ok) return r.text()
      const body = await r.json().catch(() => null)
      throw new Error(body?.error ?? `Couldn't open ${path} (${r.status})`)
    }),
  /** Asks the reviewer's agent about one change; can take a while. */
  ask: (id: string, req: AskRequest) => post<AskResponse>(`/api/reviews/${id}/ask`, req),
  /** `fullRepo` is `owner/repo`. */
  localRepo: (fullRepo: string) => request<LocalRepo>(`/api/repos/${fullRepo}/local`),
  setLocalRepo: (fullRepo: string, path: string | null) => put<LocalRepo>(`/api/repos/${fullRepo}/local`, { path }),
  submit: (id: string, req: SubmitRequest) => post<SubmitResponse>(`/api/reviews/${id}/submit`, req),
  conversation: (id: string) => request<Conversation>(`/api/reviews/${id}/conversation`),
  /** Type errors and lint findings for the stored head; null until computed. */
  diagnostics: (id: string) => file(id, 'diagnostics.json').then((r) => json<Diagnostics>(r)),
  rediagnose: (id: string) => post<null>(`/api/reviews/${id}/diagnostics`, {}),
  /** Outside uses of every changed file, once the background job has worked them out. */
  outsideUsesFile: (id: string) => file(id, 'outside-uses.json').then((r) => json<OutsideUsesFile>(r)),
  /** The agent's second opinion for the stored head; null until it has run. */
  aiReview: (id: string) => file(id, 'ai-review.json').then((r) => json<AiReview>(r)),
  rereview: (id: string) => post<null>(`/api/reviews/${id}/second-opinion`, {}),
  prStatus: (id: string) => request<PrStatus>(`/api/reviews/${id}/pr-status`),
  /** The PR's status and threads as last fetched from GitHub; null before the first fetch. */
  savedPrStatus: (id: string) => file(id, 'pr-status.json').then((r) => json<SavedPrStatus>(r)),
  savedConversation: (id: string) => file(id, 'conversation.json').then((r) => json<SavedConversation>(r)),
  replyToThread: (id: string, thread: string, body: string) =>
    post<ThreadComment>(`/api/reviews/${id}/threads/${thread}/replies`, { body }),
  resolveThread: (id: string, thread: string, resolved: boolean) =>
    put<ThreadResolved>(`/api/reviews/${id}/threads/${thread}/resolved`, { resolved }),
  saveProgress: (id: string, progress: unknown) => put<null>(`/api/reviews/${id}/progress`, progress),
  review: (id: string) => request<Review>(`/api/reviews/${id}/files/review.json`),
  /** Unified diff sections for these files, or the whole PR when `files` is empty. */
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
  // Reviews stored by an older Grain lack newer fields; read them as empty (or one chapter) instead of crashing.
  const legacy = (): Review['story'] => {
    const blocks = review.blocks.filter((b) => !b.skim).map((b) => b.id)
    const chapter = (id: number, kind: 'area' | 'routine', title: string, ids: number[]) => ({ id, key: title, kind, title, entry: null, about: title, sections: [{ title: '', blocks: ids }] })
    return { flows: false, chapters: [blocks.length && chapter(1, 'area', 'All changes', blocks), review.skim.length && chapter(2, 'routine', 'Routine', review.skim)].filter((c) => !!c) }
  }
  const r: Review = { ...review, links: review.links ?? [], uses: review.uses ?? [], story: review.story ?? legacy() }
  return { ...base, review: r, blocks: new Map(r.blocks.map((b) => [b.id, b])) }
}
