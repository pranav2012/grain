import { put, request } from '@/lib/http'
import type { Me } from '@/types/generated/Me'
import type { Settings } from '@/types/generated/Settings'

export const settingsApi = {
  get: () => request<Settings>('/api/settings'),
  save: (s: Settings) => put<Settings>('/api/settings', s),
  me: () => request<Me>('/api/me'),
}
