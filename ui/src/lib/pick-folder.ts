import { post } from '@/lib/http'
import type { PickFolderResponse } from '@/types/generated/PickFolderResponse'

/** Opens the computer's own folder picker; resolves to the chosen path, or `null` if cancelled. */
export const pickFolder = (prompt: string) => post<PickFolderResponse>('/api/pick-folder', { prompt }).then((r) => r.path)
