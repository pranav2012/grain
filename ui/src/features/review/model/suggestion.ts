import type { FileDiffMetadata } from '@pierre/diffs'

/** New-code text of lines `start`–`end` (1-based), or null when any of them isn't in the diff. */
export function newLines(file: FileDiffMetadata, start: number, end: number): string | null {
  const out: string[] = []
  for (let n = start; n <= end; n++) {
    const hunk = file.hunks.find((h) => n >= h.additionStart && n < h.additionStart + h.additionCount)
    if (!hunk) return null
    const line = file.additionLines[hunk.additionLineIndex + (n - hunk.additionStart)]
    if (line === undefined) return null
    out.push(line.replace(/\r?\n$/, ''))
  }
  return out.join('\n')
}

/** A fenced block GitHub turns into a one-click "Commit suggestion"; the fence outgrows any backticks in the code. */
export function suggestionBlock(code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}suggestion\n${code}\n${fence}`
}
