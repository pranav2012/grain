import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import type { Block, Mode, PrMeta, Review, Risk, Summary } from './types'

export interface LoadedPr {
  name: string
  review: Review
  summaries: Record<string, Summary>
  pr: PrMeta | null
  files: Map<string, FileDiffMetadata>
  blocks: Map<number, Block>
}

async function json<T>(url: string): Promise<T | null> {
  const r = await fetch(url)
  if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
  return (await r.json()) as T
}

export async function loadPr(name: string): Promise<LoadedPr> {
  const [review, summaries, pr, patch] = await Promise.all([
    json<Review>(`/data/${name}.review.json`),
    json<Record<string, Summary>>(`/data/${name}.summaries.json`),
    json<PrMeta>(`/data/${name}.pr.json`),
    fetch(`/data/${name}.patch`).then((r) => (r.ok ? r.text() : '')),
  ])
  if (!review) throw new Error(`No review data for "${name}". Run spikes/try.sh for this PR first.`)
  const files = new Map<string, FileDiffMetadata>()
  for (const p of parsePatchFiles(patch, name)) {
    for (const f of p.files) {
      files.set(f.name, f)
      if (f.prevName) files.set(f.prevName, f)
    }
  }
  return { name, review, summaries: summaries ?? {}, pr, files, blocks: new Map(review.blocks.map((b) => [b.id, b])) }
}

const riskRank: Record<Risk | 'unknown', number> = { high: 0, medium: 1, unknown: 2, low: 3 }

export function riskOf(data: LoadedPr, id: number): Risk | 'unknown' {
  return data.summaries[String(id)]?.risk ?? 'unknown'
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
  const s = data.summaries[String(b.id)]
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
