import { riskOf } from './describe'
import type { LoadedPr, Mode, Section } from './types'

const riskRank = { high: 0, medium: 1, unknown: 2, low: 3 } as const

/** Reading order: peer reads foundations-first like a story; self and maintainer go riskiest-first. */
export function sectionsFor(data: LoadedPr, mode: Mode): Section[] {
  const rank = (id: number) => riskRank[riskOf(data, id)]
  let chapters = data.review.chapters.map((c) => ({ ...c, blocks: [...c.blocks] }))
  if (mode !== 'peer') {
    chapters.forEach((c) => c.blocks.sort((a, b) => rank(a) - rank(b)))
    chapters = [...chapters].sort((a, b) => Math.min(...a.blocks.map(rank)) - Math.min(...b.blocks.map(rank)))
  }
  const sections: Section[] = chapters.map((c) => ({ key: `c${c.id}`, title: c.title, chapterId: c.id, blocks: c.blocks }))
  if (data.review.skim.length) sections.push({ key: 'skim', title: 'Skim', blocks: data.review.skim })
  return sections
}
