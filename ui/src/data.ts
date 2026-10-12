import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { api } from './api'
import type { Block, Mode, PrMeta, Review, Risk, Summary } from './types'

export interface LoadedPr {
  name: string
  review: Review
  summaries: Record<string, Summary>
  pr: PrMeta | null
  files: Map<string, FileDiffMetadata>
  blocks: Map<number, Block>
}

async function json<T>(r: Response): Promise<T | null> {
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
  return (await r.json()) as T
}

/** Loads a prepared PR (`owner/repo/123`) from the local Grain server. */
export async function loadPr(name: string): Promise<LoadedPr> {
  const [review, summaries, pr, patch] = await Promise.all([
    api.file(name, 'review.json').then((r) => json<Review>(r)),
    api.file(name, 'summaries.json').then((r) => json<Record<string, Summary>>(r)),
    api.file(name, 'pr.json').then((r) => json<PrMeta>(r)),
    api.file(name, 'diff.patch').then((r) => (r.ok ? r.text() : '')),
  ])
  if (!review) throw new Error(`"${name}" hasn't been prepared yet.`)
  const files = new Map<string, FileDiffMetadata>()
  for (const p of parsePatchFiles(patch, name)) {
    for (const f of p.files) {
      files.set(f.name, f)
      if (f.prevName) files.set(f.prevName, f)
    }
  }
  return { name, review, summaries: summaries ?? {}, pr, files, blocks: new Map(review.blocks.map((b) => [b.id, b])) }
}

export function summaryOf(data: LoadedPr, b: Block): Summary | undefined {
  return data.summaries[b.key]
}

const riskRank: Record<Risk | 'unknown', number> = { high: 0, medium: 1, unknown: 2, low: 3 }

/** Agent risk when a summary exists, otherwise the engine's rule-based estimate. */
export function riskOf(data: LoadedPr, id: number): Risk | 'unknown' {
  const b = data.blocks.get(id)
  return (b && summaryOf(data, b)?.risk) ?? b?.est_risk ?? 'unknown'
}

export function agentName(data: LoadedPr): string | null {
  const a = data.pr?.agent
  if (!a) return null
  return { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }[a] ?? a
}

const plural = (n: number, kind: string) => {
  const k = kind.replace(/_/g, ' ')
  if (n === 1) return `1 ${k}`
  return `${n} ${/(s|x|ch|sh)$/.test(k) ? `${k}es` : k.endsWith('y') ? `${k.slice(0, -1)}ies` : `${k}s`}`
}

const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Plain description of a block built only from the code changes, used when there is no AI summary. */
export function factsSentence(b: Block): string {
  const code = b.changes.filter((c) => !/\.(test|spec)\.|__tests__\//.test(c.file) && !/orphan|module-level/.test(`${c.kind} ${c.name}`))
  const tests = b.changes.filter((c) => /\.(test|spec)\.|__tests__\//.test(c.file))
  const count = (change: string) => {
    const by = new Map<string, number>()
    for (const c of code.filter((c) => c.change === change)) by.set(c.kind, (by.get(c.kind) ?? 0) + 1)
    return [...by].sort((a, z) => z[1] - a[1]).map(([k, n]) => plural(n, k))
  }
  const names = (change: string) => {
    const xs = [...new Set(code.filter((c) => c.change === change).map((c) => c.name))]
    return xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : joinList(xs)
  }
  const parts: string[] = []
  const added = count('added')
  if (added.length) parts.push(`Adds ${joinList(added)}.`)
  if (code.some((c) => c.change === 'modified')) parts.push(`Changes ${names('modified')}.`)
  const removed = count('deleted')
  if (removed.length) parts.push(`Removes ${joinList(removed)}.`)
  const renamed = code.filter((c) => c.old_name).map((c) => `${c.old_name} to ${c.name}`)
  if (renamed.length) parts.push(`Renames ${joinList(renamed.slice(0, 3))}.`)
  const moved = code.filter((c) => c.change === 'moved').length
  if (moved) parts.push(`Moves ${moved} ${moved === 1 ? 'piece' : 'pieces'} of code.`)
  if (tests.length) parts.push(`Updates tests in ${new Set(tests.map((t) => t.file)).size} ${new Set(tests.map((t) => t.file)).size === 1 ? 'file' : 'files'}.`)
  if (!parts.length) parts.push(`Changes ${b.files.length === 1 ? 'one file' : `${b.files.length} files`} without named code changes, such as imports or top-level statements.`)
  return parts.join(' ')
}

export interface Section {
  key: string
  title: string
  chapterId?: number
  blocks: number[]
}

/** Reading order: peer reads foundations-first like a story; self and maintainer go riskiest-first. */
export function sectionsFor(data: LoadedPr, mode: Mode): Section[] {
  const byRisk = (a: number, b: number) => riskRank[riskOf(data, a)] - riskRank[riskOf(data, b)]
  const chapterRisk = (ids: number[]) => Math.min(...ids.map((id) => riskRank[riskOf(data, id)]))
  let chapters = data.review.chapters.map((c) => ({ ...c, blocks: [...c.blocks] }))
  if (mode !== 'peer') {
    chapters.forEach((c) => c.blocks.sort(byRisk))
    chapters = [...chapters].sort((a, b) => chapterRisk(a.blocks) - chapterRisk(b.blocks))
  }
  const sections: Section[] = chapters.map((c) => ({ key: `c${c.id}`, title: c.title, chapterId: c.id, blocks: c.blocks }))
  if (data.review.skim.length) sections.push({ key: 'skim', title: 'Skim', blocks: data.review.skim })
  return sections
}

const skimLabels: Record<string, string> = {
  'repeated edit': 'Same edit in',
  lockfile: 'Lockfiles',
  generated: 'Generated files',
  asset: 'Assets and data files',
  docs: 'Docs',
  mechanical: 'Formatting, moves and renames',
}

/** Human title for a block: the agent's title, else the main symbols it changes. */
export function blockTitle(data: LoadedPr, b: Block): string {
  const s = summaryOf(data, b)
  if (s?.title) return s.title
  if (b.skim) {
    const label = skimLabels[b.skim] ?? b.skim
    return b.skim === 'repeated edit' ? `${label} ${b.files.length} files` : label
  }
  const code = b.files.filter((f) => !/\.(test|spec)\.|__tests__/.test(f))
  const main = (code.length ? code : b.files).reduce((a, f) => (b.entities.filter((e) => e.includes(f)).length > b.entities.filter((e) => e.includes(a)).length ? f : a))
  const name = main.split('/').pop()!.replace(/\.[^.]+$/, '')
  const others = b.files.length - 1
  return others ? `${name} and ${others} related ${others === 1 ? 'file' : 'files'}` : name
}

/** Entity descriptions worth showing a reviewer (drops parser bookkeeping like module-level chunks). */
export function meaningfulEntities(b: Block): string[] {
  return b.entities
    .filter((e) => !/orphan|module-level/.test(e))
    .map((e) => e.replace(/\s\(.*\)$/, '').replace(/`/g, '').replace(/^(\w+) (\w+)_(\w+) /, '$1 $2 $3 '))
}

export function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}

/** Rough reading time at ~40 changed lines per minute. */
export function minutesFor(lines: number): number {
  return Math.max(1, Math.round(lines / 40))
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}
