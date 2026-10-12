import type { Summary } from './types'

export interface PrListItem {
  repo: string
  number: number
  title: string
  author: string
  updatedAt?: string
  isDraft?: boolean
  url?: string
}

export interface RepoItem {
  fullName: string
  description: string
  pushedAt: string
}

export interface Settings {
  agent: 'claude' | 'codex' | 'opencode' | null
  model: string | null
  maxSummariesPerReview: number
}

export interface Status {
  job: { stage: 'preparing' | 'ready' | 'failed'; message: string }
  summarizer: { running: boolean; pending: number; freshRequests: number; stopped: string | null } | null
  agent: Settings['agent']
}

const offline = "Can't reach the Grain server. Start it with `grain` in a terminal, then try again."

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init }).catch(() => {
    throw new Error(offline)
  })
  if (r.status === 502 || r.status === 504) throw new Error(offline)
  const body = r.status === 202 ? null : await r.json().catch(() => null)
  if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`)
  return body as T
}

export const api = {
  me: () => call<{ login: string; agentsInstalled: string[] }>('/api/me'),
  inbox: () => call<{ reviewRequests: PrListItem[]; mine: PrListItem[] }>('/api/inbox'),
  recent: () => call<PrListItem[]>('/api/reviews'),
  repos: (q: string) => call<RepoItem[]>(`/api/repos?q=${encodeURIComponent(q)}`),
  repoPulls: (fullName: string) => call<PrListItem[]>(`/api/repos/${fullName}/pulls`),
  open: (pr: string) => call<{ id: string }>('/api/open', { method: 'POST', body: JSON.stringify({ pr }) }),
  status: (id: string) => call<Status>(`/api/reviews/${id}/status`),
  file: (id: string, name: string) => fetch(`/api/reviews/${id}/files/${name}`),
  summaries: (id: string) => call<Record<string, Summary>>(`/api/reviews/${id}/files/summaries.json`),
  summarize: (id: string, keys: string[]) => call<null>(`/api/reviews/${id}/summarize`, { method: 'POST', body: JSON.stringify({ keys }) }),
  settings: () => call<Settings>('/api/settings'),
  saveSettings: (s: Settings) => call<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
}

/** Accepts a GitHub PR link, owner/repo#123 or owner/repo/123 and returns owner/repo/123. */
export function parsePrRef(input: string): string | null {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/^github\.com\//, '')
  const m = /^([\w.-]+)\/([\w.-]+)(?:\/pulls?\/|#|\/)(\d+)/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null
}
