import { put, request } from '@/lib/http'
import type { Agent } from '@/types/generated/Agent'
import type { Me } from '@/types/generated/Me'
import type { ModelsResponse } from '@/types/generated/ModelsResponse'
import type { Settings } from '@/types/generated/Settings'
import type { UsageReport } from '@/types/generated/UsageReport'

export const settingsApi = {
  get: () => request<Settings>('/api/settings'),
  save: (s: Settings) => put<Settings>('/api/settings', s),
  me: () => request<Me>('/api/me'),
  usage: () => request<UsageReport>('/api/usage'),
  /** Can take a few seconds the first time: the agent lists its own models. */
  models: (agent: Agent) => request<ModelsResponse>(`/api/models?agent=${agent}`),
}
