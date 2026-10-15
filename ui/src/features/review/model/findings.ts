import type { Finding } from '@/types/generated/Finding'

/** Stable identity for a finding, so the reviewer's call survives a re-run on the same head. */
export const findingKey = (f: Finding) => `${f.file}:${f.line}:${f.title}`

export const isNewSide = (el: Element) => !(el.getAttribute('data-line-type') ?? '').includes('deletion')

/** The rendered row for a new-side line inside a file's diff, if it is drawn right now. */
export function rowFor(section: Element, line: number): HTMLElement | null {
  for (const host of section.querySelectorAll('diffs-container')) {
    for (const row of host.shadowRoot?.querySelectorAll<HTMLElement>(`[data-line="${line}"]`) ?? []) if (isNewSide(row)) return row
  }
  return null
}
