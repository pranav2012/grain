import { request } from '@/lib/http'
import type { Inbox } from '@/types/generated/Inbox'
import type { PrSummary } from '@/types/generated/PrSummary'
import type { RecentReview } from '@/types/generated/RecentReview'
import type { RepoSummary } from '@/types/generated/RepoSummary'

export const pickerApi = {
  inbox: () => request<Inbox>('/api/inbox'),
  recent: () => request<RecentReview[]>('/api/reviews'),
  repos: (q: string) => request<RepoSummary[]>(`/api/repos?q=${encodeURIComponent(q)}`),
  repoPulls: (fullName: string) => request<PrSummary[]>(`/api/repos/${fullName}/pulls`),
}
