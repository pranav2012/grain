import type { Chapter } from '@/types/generated/Chapter'
import type { LoadedPr } from './types'

/** Blocks in files the reviewer owns (CODEOWNERS). */
export function ownedBlocks(data: LoadedPr): Set<number> {
  const mine = new Set(data.owners.mine)
  return new Set([...data.blocks.values()].filter((b) => b.files.some((f) => mine.has(f))).map((b) => b.id))
}

/** The story's chapters; with `mineFirst`, the reviewer's own code (CODEOWNERS) comes first as its own chapter. */
export function chaptersFor(data: LoadedPr, mineFirst: boolean): Chapter[] {
  const chapters = data.review.story.chapters
  const owned = mineFirst ? ownedBlocks(data) : new Set<number>()
  if (!owned.size) return chapters
  const mine: Chapter = {
    id: 0,
    key: 'mine',
    kind: 'area',
    title: 'Your code',
    entry: null,
    about: 'Changes in files you own (CODEOWNERS)',
    sections: [{ title: '', blocks: chapters.flatMap((c) => c.sections.flatMap((s) => s.blocks)).filter((id) => owned.has(id)) }],
  }
  const rest = chapters
    .map((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, blocks: s.blocks.filter((id) => !owned.has(id)) })).filter((s) => s.blocks.length) }))
    .filter((c) => c.sections.length)
  return [mine, ...rest]
}

export const kindLabel: Record<Chapter['kind'], string> = {
  flow: 'User flow',
  screens: 'Flows',
  preview: 'Preview and dev pages',
  also: 'Not reached by a flow',
  area: 'Area',
  routine: 'Routine',
}
