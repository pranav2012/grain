import type { Finding } from '@/types/generated/Finding'

/** Stable identity for a finding, so the reviewer's call survives a re-run on the same head. */
export const findingKey = (f: Finding) => `${f.file}:${f.line}:${f.title}`

/** Old-side rows are deletions, or any row in split view's left column. */
export const isNewSide = (el: Element) => !(el.getAttribute('data-line-type') ?? '').includes('deletion') && !el.closest('[data-deletions]')

/** The rendered row for a line on one side of a file's diff (new side by default), if it is drawn right now. */
export function rowFor(section: Element, line: number, side: 'additions' | 'deletions' = 'additions'): HTMLElement | null {
  for (const host of section.querySelectorAll('diffs-container')) {
    for (const row of host.shadowRoot?.querySelectorAll<HTMLElement>(`[data-line="${line}"]`) ?? []) if (isNewSide(row) === (side === 'additions')) return row
  }
  return null
}
