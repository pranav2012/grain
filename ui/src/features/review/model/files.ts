import type { Chapter } from '@/types/generated/Chapter'
import { isTestPath } from './describe'
import type { LoadedPr } from './types'

export interface FileSection {
  title: string
  files: string[]
}

/** A story chapter as whole files: each changed file appears once, in the first chapter that reaches it. */
export interface FileChapter {
  chapter: Chapter
  sections: FileSection[]
  tests: string[]
}

/** Places each file in the chapter and section of the first block that touches it; tests go last, ungrouped files at the end. */
export function fileChapters(data: LoadedPr, chapters: Chapter[], allFiles: string[]): FileChapter[] {
  const seen = new Set<string>()
  const out: FileChapter[] = []
  for (const chapter of chapters) {
    const fc: FileChapter = { chapter, sections: [], tests: [] }
    for (const s of chapter.sections) {
      const files: string[] = []
      for (const id of s.blocks) {
        const b = data.blocks.get(id)
        if (!b) continue
        const ordered = [...b.files.filter((f) => !isTestPath(f)), ...b.files.filter(isTestPath)]
        for (const f of ordered) {
          if (seen.has(f)) continue
          seen.add(f)
          if (isTestPath(f)) fc.tests.push(f)
          else files.push(f)
        }
      }
      if (files.length) fc.sections.push({ title: chapter.sections.length > 1 ? s.title : '', files })
    }
    if (fc.sections.length || fc.tests.length) out.push(fc)
  }
  const rest = allFiles.filter((f) => !seen.has(f))
  if (rest.length) {
    const chapter: Chapter = { id: chapters.length + 1, key: 'other-files', kind: 'also', title: 'Other files', entry: null, about: 'Changed files Grain did not group', sections: [] }
    out.push({ chapter, sections: [{ title: '', files: rest.filter((f) => !isTestPath(f)) }].filter((s) => s.files.length), tests: rest.filter(isTestPath) })
  }
  return out
}

export const filesInOrder = (chapters: FileChapter[]) => chapters.flatMap((c) => [...c.sections.flatMap((s) => s.files), ...c.tests])

export function blocksByFile(data: LoadedPr): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const b of data.blocks.values()) for (const f of b.files) map.set(f, [...(map.get(f) ?? []), b.id])
  return map
}

export interface UsedBy {
  /** Changed names in this file and the other PR files that use each. */
  inside: { name: string; files: string[] }[]
  outside: string[]
  outsideCount: number
}

/** Who uses a file's changes: other PR files per changed name, plus the engine's outside production users. */
export function usedBy(data: LoadedPr, file: string, byFile: Map<string, number[]>): UsedBy {
  const names = new Map<string, Set<string>>()
  for (const u of data.review.uses) if (u.file === file) names.set(u.name, (names.get(u.name) ?? new Set()).add(u.userFile))
  const inside = [...names].map(([name, files]) => ({ name, files: [...files].sort() })).sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name))
  const blocks = (byFile.get(file) ?? []).map((id) => data.blocks.get(id)!).filter(Boolean)
  const outside = [...new Set(blocks.flatMap((b) => b.usedBySample))]
  const outsideCount = blocks.reduce((n, b) => Math.max(n, b.usedBy), 0)
  return { inside, outside, outsideCount: Math.max(outsideCount, outside.length) }
}
