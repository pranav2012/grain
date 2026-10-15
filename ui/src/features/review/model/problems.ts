import type { FileDiffMetadata } from '@pierre/diffs'
import type { Diagnostic } from '@/types/generated/Diagnostic'
import type { Diagnostics } from '@/types/generated/Diagnostics'
import type { PrStatus } from '@/types/generated/PrStatus'

/** A type error, lint finding or CI annotation at a line of a changed file. */
export type Problem = Diagnostic & { id: string }

/** New-side line numbers the PR added or changed in a file. */
export function changedLines(diff: FileDiffMetadata): Set<number> {
  const out = new Set<number>()
  for (const h of diff.hunks) {
    let line = h.additionStart
    for (const part of h.hunkContent) {
      if (part.type === 'context') line += part.lines
      else {
        for (let i = 0; i < part.additions; i++) out.add(line + i)
        line += part.additions
      }
    }
  }
  return out
}

/** Local tool findings plus CI annotations that point into the PR's files, in file and line order. */
export function allProblems(report: Diagnostics | null, status: PrStatus | null, files: Set<string>): Problem[] {
  const out: Diagnostic[] = [...(report?.items ?? [])]
  for (const run of status?.checks ?? [])
    for (const a of run.annotations) {
      if (!files.has(a.path) || a.level === 'notice') continue
      out.push({
        file: a.path,
        line: a.startLine,
        endLine: a.endLine,
        column: 1,
        length: null,
        severity: a.level === 'failure' ? 'error' : 'warning',
        message: a.title ? `${a.title}: ${a.message}` : a.message,
        source: `CI · ${run.name}`,
        code: null,
        url: run.url,
      })
    }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
  return out.map((d, i) => ({ ...d, id: `p${i}` }))
}

export interface FileProblems {
  /** On lines this PR changed; shown under their line. */
  shown: Problem[]
  /** Elsewhere in the file (code the PR didn't touch). */
  other: Problem[]
}

export function problemsByFile(problems: Problem[], changed: (file: string) => Set<number> | null): Map<string, FileProblems> {
  const map = new Map<string, FileProblems>()
  for (const p of problems) {
    const lines = changed(p.file)
    const entry = map.get(p.file) ?? { shown: [], other: [] }
    const touched = !lines || Array.from({ length: p.endLine - p.line + 1 }, (_, i) => p.line + i).some((l) => lines.has(l))
    ;(touched ? entry.shown : entry.other).push(p)
    map.set(p.file, entry)
  }
  return map
}
