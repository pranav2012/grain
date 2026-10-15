import type { Chapter } from '@/types/generated/Chapter'
import type { LayerSummary } from '@/types/generated/LayerSummary'
import type { LoadedPr } from './types'

export const isTestPath = (p: string) => /\.(test|spec)\.|__tests__\//.test(p)

/** Summary key for a chapter intro; block keys never start with `chapter:`. */
export const chapterSummaryKey = (c: Chapter) => `chapter:${c.key}`

export function chapterSummaryOf(data: LoadedPr, c: Chapter): LayerSummary | undefined {
  return data.summaries[chapterSummaryKey(c)] as LayerSummary | undefined
}

export function agentName(data: LoadedPr): string | null {
  const a = data.pr?.agent
  if (!a) return null
  return { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }[a]
}
