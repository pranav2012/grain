import { joinList, plural } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import type { Risk } from '@/types/generated/Risk'
import type { Summary } from '@/types/generated/Summary'
import type { LoadedPr } from './types'

const isTestPath = (p: string) => /\.(test|spec)\.|__tests__\//.test(p)

export function summaryOf(data: LoadedPr, b: Block): Summary | undefined {
  return data.summaries[b.key]
}

/** Agent risk when a summary exists, otherwise the engine's rule-based estimate. */
export function riskOf(data: LoadedPr, id: number): Risk | 'unknown' {
  const b = data.blocks.get(id)
  return ((b && summaryOf(data, b)?.risk) as Risk | undefined) ?? b?.estRisk ?? 'unknown'
}

export function agentName(data: LoadedPr): string | null {
  const a = data.pr?.agent
  if (!a) return null
  return { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' }[a]
}

const skimLabels: Record<string, string> = {
  'repeated edit': 'Same edit in',
  lockfile: 'Lockfiles',
  generated: 'Generated files',
  asset: 'Assets and data files',
  docs: 'Docs',
  mechanical: 'Formatting, moves and renames',
}

/** Human title for a block: the agent's title, else its main file and how many related files. */
export function blockTitle(data: LoadedPr, b: Block): string {
  const s = summaryOf(data, b)
  if (s?.title) return s.title
  if (b.skim) {
    const label = skimLabels[b.skim] ?? b.skim
    return b.skim === 'repeated edit' ? `${label} ${b.files.length} files` : label
  }
  const code = b.files.filter((f) => !isTestPath(f))
  const count = (f: string) => b.entities.filter((e) => e.includes(f)).length
  const main = (code.length ? code : b.files).reduce((a, f) => (count(f) > count(a) ? f : a))
  const name = main.split('/').pop()!.replace(/\.[^.]+$/, '')
  const others = b.files.length - 1
  return others ? `${name} and ${others} related ${others === 1 ? 'file' : 'files'}` : name
}

/** Entity descriptions worth showing a reviewer (drops parser bookkeeping like module-level chunks). */
export function meaningfulEntities(b: Block): string[] {
  return b.entities
    .filter((e) => !/orphan|module-level/.test(e))
    .map((e) =>
      e
        .replace(/\s\(.*\)$/, '')
        .replace(/`/g, '')
        .replace(/^(\w+) (\w+)_(\w+) /, '$1 $2 $3 '),
    )
}

/** Plain description of a block built only from the code changes, used when there is no AI summary. */
export function factsSentence(b: Block): string {
  const code = b.changes.filter((c) => !isTestPath(c.file) && !/orphan|module-level/.test(`${c.kind} ${c.name}`))
  const testFiles = new Set(b.changes.filter((c) => isTestPath(c.file)).map((c) => c.file))
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
  const renamed = code.filter((c) => c.oldName).map((c) => `${c.oldName} to ${c.name}`)
  if (renamed.length) parts.push(`Renames ${joinList(renamed.slice(0, 3))}.`)
  const moved = code.filter((c) => c.change === 'moved').length
  if (moved) parts.push(`Moves ${moved} ${moved === 1 ? 'piece' : 'pieces'} of code.`)
  if (testFiles.size) parts.push(`Updates tests in ${testFiles.size} ${testFiles.size === 1 ? 'file' : 'files'}.`)
  if (!parts.length) {
    parts.push(`Changes ${b.files.length === 1 ? 'one file' : `${b.files.length} files`} without named code changes, such as imports or top-level statements.`)
  }
  return parts.join(' ')
}
