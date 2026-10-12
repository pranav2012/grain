import { riskOf } from './describe'
import type { LoadedPr, Mode, Section } from './types'

const riskRank = { high: 0, medium: 1, unknown: 2, low: 3 } as const

/** Blocks in files the reviewer owns (CODEOWNERS). */
export function ownedBlocks(data: LoadedPr): Set<number> {
  const mine = new Set(data.owners.mine)
  return new Set([...data.blocks.values()].filter((b) => b.files.some((f) => mine.has(f))).map((b) => b.id))
}

/**
 * Reading order: peer reads foundations-first like a story; self and maintainer go riskiest-first.
 * Parts of a split file share their riskiest part's rank so they stay in order. With `mineFirst`,
 * blocks the reviewer owns come first in their own section.
 */
export function sectionsFor(data: LoadedPr, mode: Mode, mineFirst = false): Section[] {
  const partRank = new Map<string, number>()
  for (const b of data.blocks.values())
    if (b.slice) partRank.set(b.files[0], Math.min(partRank.get(b.files[0]) ?? 9, riskRank[riskOf(data, b.id)]))
  const rank = (id: number) => {
    const b = data.blocks.get(id)!
    return b.slice ? partRank.get(b.files[0])! : riskRank[riskOf(data, id)]
  }
  let chapters = data.review.chapters.map((c) => ({ ...c, blocks: [...c.blocks] }))
  if (mode !== 'peer') {
    chapters.forEach((c) => c.blocks.sort((a, b) => rank(a) - rank(b)))
    chapters = [...chapters].sort((a, b) => Math.min(...a.blocks.map(rank)) - Math.min(...b.blocks.map(rank)))
  }
  let sections: Section[] = chapters.map((c) => ({ key: `c${c.id}`, title: c.title, chapterId: c.id, blocks: c.blocks }))
  if (data.review.skim.length) sections.push({ key: 'skim', title: 'Skim', blocks: data.review.skim })
  const owned = mineFirst ? ownedBlocks(data) : new Set<number>()
  if (owned.size) {
    const mine = sections.flatMap((s) => s.blocks.filter((id) => owned.has(id)))
    sections = sections.map((s) => ({ ...s, blocks: s.blocks.filter((id) => !owned.has(id)) })).filter((s) => s.blocks.length)
    sections.unshift({ key: 'mine', title: 'Your code (CODEOWNERS)', blocks: mine })
  }
  return sections
}
