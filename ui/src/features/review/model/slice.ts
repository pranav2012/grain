import type { Slice } from '@/types/generated/Slice'

type Range = [number, number]

const within = (ranges: Range[], n: number) => ranges.some(([s, e]) => s <= n && n <= e)

interface Kept {
  text: string
  oldNo: number
  newNo: number
  index: number
}

/** Rebuilds one hunk from adjacent kept lines, with correct `@@` counts. */
function toHunk(lines: Kept[]): string[] {
  const oldCount = lines.filter((l) => l.text[0] !== '+' && l.text[0] !== '\\').length
  const newCount = lines.filter((l) => l.text[0] !== '-' && l.text[0] !== '\\').length
  // Empty sides point at the line before the change, as git writes them.
  const oldStart = oldCount ? lines[0].oldNo : lines[0].oldNo - 1
  const newStart = newCount ? lines[0].newNo : lines[0].newNo - 1
  return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...lines.map((l) => l.text)]
}

/**
 * Cuts a unified diff down to a slice's lines, even inside one giant hunk; line numbers stay real.
 * `newSideOnly` (diffs between two heads) places removed lines by their new-side position.
 */
export function keepSliceLines(patch: string, slice: Slice, newSideOnly = false): string {
  const out: string[] = []
  let kept: Kept[] = []
  let oldNo = 0
  let newNo = 0
  let index = 0
  let inHunk = false
  const flush = () => {
    let run: Kept[] = []
    for (const l of kept) {
      if (run.length && l.index !== run[run.length - 1].index + 1) {
        out.push(...toHunk(run))
        run = []
      }
      run.push(l)
    }
    if (run.length) out.push(...toHunk(run))
    kept = []
  }
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) {
      flush()
      oldNo = Number(header[1])
      newNo = Number(header[2])
      inHunk = true
      continue
    }
    if (line.startsWith('diff --git ')) {
      flush()
      inHunk = false
    }
    if (!inHunk) {
      out.push(line)
      continue
    }
    if (!line) continue
    const mark = line[0]
    const keep =
      mark === '+' || mark === ' '
        ? within(slice.newLines, newNo)
        : mark === '-'
          ? newSideOnly
            ? within(slice.newLines, newNo)
            : within(slice.oldLines, oldNo)
          : kept.length > 0 && kept[kept.length - 1].index === index - 1
    if (keep) kept.push({ text: line, oldNo, newNo, index })
    if (mark === ' ' || mark === '-') oldNo++
    if (mark === ' ' || mark === '+') newNo++
    index++
  }
  flush()
  return out.join('\n')
}

export const sliceKey = (slice: Slice | null | undefined) => (slice ? `${slice.part}/${slice.of}:${slice.newLines[0]?.join('-') ?? ''}` : '')
