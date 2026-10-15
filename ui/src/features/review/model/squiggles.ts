import { isNewSide } from './findings'
import type { Problem } from './problems'

/** Styles for the marks below, injected into the diff's shadow root. */
export const squiggleCSS = `
.grain-sq-error { text-decoration: underline wavy var(--color-danger); text-underline-offset: 4px; text-decoration-skip-ink: none; }
.grain-sq-warning { text-decoration: underline wavy var(--color-warning); text-underline-offset: 4px; text-decoration-skip-ink: none; }
[data-grain-problem="error"] [data-line-number-content] { color: var(--color-danger); font-weight: 600; }
[data-grain-problem="warning"] [data-line-number-content] { color: var(--color-warning); font-weight: 600; }
[data-grain-finding] { box-shadow: inset 3px 0 var(--color-accent); }
[data-grain-hl] { outline: 1px solid var(--color-accent); outline-offset: -1px; }
`

/** Marks the line numbers of lines the agent's second opinion comments on. */
export function markFindings(root: ParentNode, lines: number[]) {
  for (const line of lines) for (const g of root.querySelectorAll(`[data-column-number="${line}"]`)) if (isNewSide(g)) g.setAttribute('data-grain-finding', '')
}


/** Wraps characters [start, end) of `row` in a span with `cls`, splitting text nodes as needed. */
function wrap(row: Element, start: number, end: number, cls: string, id: string) {
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  const pieces: [Text, number, number][] = []
  let at = 0
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length
    const from = Math.max(start, at)
    const to = Math.min(end, at + len)
    if (from < to) pieces.push([n, from - at, to - at])
    at += len
    if (at >= end) break
  }
  for (const [node, from, to] of pieces) {
    const target = node.splitText(from)
    target.splitText(to - from)
    const span = row.ownerDocument.createElement('span')
    span.className = cls
    span.dataset.grainId = id
    target.replaceWith(span)
    span.appendChild(target)
  }
}

/**
 * Underlines each problem's code and colours its line number, like an editor. Runs after every
 * render of a diff; rows already marked are left alone. Without a known length, the word at the
 * problem's column is underlined.
 */
export function markProblems(root: ParentNode, problems: Problem[]) {
  for (const p of problems) {
    for (const g of root.querySelectorAll(`[data-column-number="${p.line}"]`)) if (isNewSide(g)) g.setAttribute('data-grain-problem', p.severity)
    for (const row of root.querySelectorAll(`[data-line="${p.line}"]`)) {
      if (!isNewSide(row) || row.querySelector(`[data-grain-id="${p.id}"]`)) continue
      const text = row.textContent ?? ''
      const start = Math.max(0, Math.min(p.column - 1, text.length - 1))
      const word = /^[\w$]+/.exec(text.slice(start))?.[0].length ?? 1
      const end = p.length ? start + p.length : start + word
      wrap(row, start, Math.min(end, text.length), `grain-sq-${p.severity}`, p.id)
    }
  }
}
