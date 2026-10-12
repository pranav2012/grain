import { joinList } from '@/lib/format'
import type { Block } from '@/types/generated/Block'
import { blockTitle, isTestPath, layerSummaryOf, riskOf } from './describe'
import type { BlockState, LoadedPr, Mode, Stage, Step } from './types'

const riskRank = { high: 0, medium: 1, unknown: 2, low: 3 } as const
const SKIM_PER_STEP = 6

export const stageHelp: Record<string, string> = {
  Foundations: 'Types, data, services and helpers the rest builds on',
  'Hooks and state': 'Hooks, state and providers',
  Components: 'UI components',
  Screens: 'Screens, pages and routes',
  Code: 'Other code',
  Tests: 'Tests not tied to one change',
  'Your code': 'Files you own (CODEOWNERS)',
  Skim: 'Lockfiles, generated files, moves and repeated edits',
}

/** Blocks in files the reviewer owns (CODEOWNERS). */
export function ownedBlocks(data: LoadedPr): Set<number> {
  const mine = new Set(data.owners.mine)
  return new Set([...data.blocks.values()].filter((b) => b.files.some((f) => mine.has(f))).map((b) => b.id))
}

/**
 * The review as stages of steps. Peer review follows the engine's order (each step after what it
 * builds on); self and maintainer reviews take the riskiest steps of each stage first. With
 * `mineFirst`, steps touching the reviewer's files form a first stage.
 */
export function stagesFor(data: LoadedPr, mode: Mode, mineFirst = false): Stage[] {
  const rank = (s: Step) => Math.min(...s.blocks.map((id) => riskRank[riskOf(data, id)]))
  let steps: Step[] = data.review.layers.map((l) => ({ key: `l${l.id}`, stage: l.stage, layer: l, blocks: l.blocks }))
  if (mineFirst) {
    const owned = ownedBlocks(data)
    steps = steps.map((s) => (s.blocks.some((id) => owned.has(id)) ? { ...s, stage: 'Your code' } : s))
  }
  const skim = data.review.skim
  for (let i = 0; i < skim.length; i += SKIM_PER_STEP)
    steps.push({ key: `skim${i}`, stage: 'Skim', blocks: skim.slice(i, i + SKIM_PER_STEP) })

  const order = ['Your code', ...data.review.layers.map((l) => l.stage), 'Skim']
  const stages: Stage[] = []
  for (const name of [...new Set(order)]) {
    let own = steps.filter((s) => s.stage === name)
    if (!own.length) continue
    if (mode !== 'peer' && name !== 'Skim') own = [...own].sort((a, b) => rank(a) - rank(b))
    stages.push({ name, about: stageAbout(data, own), steps: own })
  }
  return stages
}

function stageAbout(data: LoadedPr, steps: Step[]): string {
  const names = [...new Set(steps.flatMap((s) => s.blocks.map((id) => mainName(data.blocks.get(id)!))))]
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : joinList(names)
}

function mainName(b: Block): string {
  const code = b.files.filter((f) => !isTestPath(f))
  return (code[0] ?? b.files[0]).split('/').pop()!.replace(/\.[^.]+$/, '')
}

const names = (xs: string[]) => {
  const u = [...new Set(xs)]
  return u.length > 2 ? `${u.slice(0, 2).join(', ')} and ${u.length - 2} more` : joinList(u)
}

/**
 * What a step changes in a few words, from the code alone: `Adds useVoucherData; changes safeHref`.
 * The agent's step title wins when there is one.
 */
export function stepTitle(data: LoadedPr, step: Step): string {
  if (step.layer) {
    const s = layerSummaryOf(data, step.layer)
    if (s?.title) return s.title
  }
  const blocks = step.blocks.map((id) => data.blocks.get(id)!)
  if (blocks.every((b) => b.skim)) return blocks.length === 1 ? blockTitle(data, blocks[0]) : joinList([...new Set(blocks.map((b) => blockTitle(data, b)))])
  const all = blocks.flatMap((b) => b.changes).filter((c) => !isTestPath(c.file) && !/orphan|module-level/.test(`${c.kind} ${c.name}`))
  // Functions, components and types say more than the properties and variables inside them.
  const major = all.filter((c) => !/property|field|variable|constant|import|export/.test(c.kind))
  const code = major.length ? major : all
  const of = (change: string) => code.filter((c) => c.change === change).map((c) => c.name)
  const parts = [
    of('added').length && `adds ${names(of('added'))}`,
    of('modified').length && `changes ${names(of('modified'))}`,
    of('deleted').length && `removes ${names(of('deleted'))}`,
    code.some((c) => c.oldName) && `renames ${names(code.filter((c) => c.oldName).map((c) => c.oldName!))}`,
  ].filter((x): x is string => !!x)
  const text = parts.slice(0, 2).join('; ')
  if (text) return text[0].toUpperCase() + text.slice(1)
  const tests = blocks.every((b) => b.files.every(isTestPath))
  return `${tests ? 'Updates tests for' : 'Updates'} ${names(blocks.map(mainName))}`
}

export type StepState = 'done' | 'change' | 'started' | 'todo'

export function stepState(step: Step, states: Record<number, BlockState>): StepState {
  if (step.blocks.some((id) => states[id] === 'change')) return 'change'
  const marked = step.blocks.filter((id) => states[id]).length
  return marked === step.blocks.length ? 'done' : marked ? 'started' : 'todo'
}

export const stepLines = (data: LoadedPr, step: Step) => step.blocks.reduce((n, id) => n + (data.blocks.get(id)?.lines ?? 0), 0)
