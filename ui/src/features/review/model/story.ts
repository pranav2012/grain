import { joinList } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import type { Chapter } from '@/types/generated/Chapter'
import { isTestPath } from './describe'
import type { BlockState, LoadedPr } from './types'

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

export const chapterBlocks = (c: Chapter) => c.sections.flatMap((s) => s.blocks)

export const linesOf = (data: LoadedPr, ids: number[]) => ids.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)

const names = (xs: string[]) => {
  const u = [...new Set(xs)]
  return u.length > 2 ? `${u.slice(0, 2).join(', ')} and ${u.length - 2} more` : joinList(u)
}

/** What a block changes in a few words, from the code: `Adds useVoucherData; changes safeHref.` */
export function whatChanged(b: Block): string {
  const all = b.changes.filter((c) => !isTestPath(c.file) && !/orphan|module-level/.test(`${c.kind} ${c.name}`))
  // Functions, components and types say more than the properties and variables inside them.
  const major = all.filter((c) => !/property|field|variable|constant|import|export/.test(c.kind))
  const code = major.length ? major : all
  const of = (change: string) => code.filter((c) => c.change === change).map((c) => c.name)
  const parts = [
    of('added').length && `adds ${names(of('added'))}`,
    of('modified').length && `changes ${names(of('modified'))}`,
    of('deleted').length && `removes ${names(of('deleted'))}`,
  ].filter((x): x is string => !!x)
  const tests = new Set(b.changes.filter((c) => isTestPath(c.file)).map((c) => c.file)).size
  const text = parts.slice(0, 2).join('; ')
  const head = text ? `${text[0].toUpperCase()}${text.slice(1)}.` : `Updates ${b.files.length === 1 ? 'one file' : `${b.files.length} files`}.`
  return tests ? `${head} Updates tests in ${tests === 1 ? 'one file' : `${tests} files`}.` : head
}

/** Main components or functions a chapter touches, for a one-line intro without AI. */
export function chapterHighlights(data: LoadedPr, c: Chapter): string {
  const top = chapterBlocks(c)
    .map((id) => data.blocks.get(id)!)
    .sort((a, b) => b.lines - a.lines)
    .map((b) => (b.files.find((f) => !isTestPath(f)) ?? b.files[0]).split('/').pop()!.replace(/\.[^.]+$/, ''))
  const u = [...new Set(top)]
  return u.length > 4 ? `${u.slice(0, 4).join(', ')} and ${u.length - 4} more` : joinList(u)
}

export type ProgressState = 'done' | 'change' | 'started' | 'todo'

export function progressOf(ids: number[], states: Record<number, BlockState>): ProgressState {
  if (ids.some((id) => states[id] === 'change')) return 'change'
  const marked = ids.filter((id) => states[id]).length
  return marked === ids.length ? 'done' : marked ? 'started' : 'todo'
}

export const kindLabel: Record<Chapter['kind'], string> = {
  flow: 'Flow',
  screens: 'Flows',
  preview: 'Preview and dev pages',
  also: 'Not reached by a flow',
  area: 'Area',
  routine: 'Routine',
}
