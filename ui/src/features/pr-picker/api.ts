import { post, request } from '@/lib/http'
import type { LocalCandidate } from '@/types/generated/LocalCandidate'
import type { OpenResponse } from '@/types/generated/OpenResponse'
import type { Inbox } from '@/types/generated/Inbox'
import type { PrSummary } from '@/types/generated/PrSummary'
import type { RecentReview } from '@/types/generated/RecentReview'
import type { RepoSummary } from '@/types/generated/RepoSummary'

export const pickerApi = {
  inbox: () => request<Inbox>('/api/inbox'),
  recent: () => request<RecentReview[]>('/api/reviews'),
  repos: (q: string) => request<RepoSummary[]>(`/api/repos?q=${encodeURIComponent(q)}`),
  repoPulls: (fullName: string) => request<PrSummary[]>(`/api/repos/${fullName}/pulls`),
  /** Git repositories on this machine, most recently active first. */
  localRepos: () => request<LocalCandidate[]>('/api/local'),
  /** Starts a self-review of a folder's branch and uncommitted changes; returns the review id. */
  openLocal: (path: string) => post<OpenResponse>('/api/local', { path }),
}
