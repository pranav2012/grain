import type { Verdict } from '../state/useReviewState'
import type { BlockState, LoadedPr } from './types'

export interface BlockProgress {
  /** Verdicts that still apply (same content as when reviewed), by block id. */
  states: Record<number, BlockState>
  /** Blocks reviewed on an earlier push that changed since, by block id → head reviewed. */
  stale: Record<number, string>
}

/**
 * Applies saved verdicts to the current version of the PR. A verdict holds while the block's
 * content hash is unchanged; otherwise the block reopens as "changed since you reviewed it".
 * Blocks whose key is new but which mostly cover files of an earlier reviewed block count as
 * changed too (a symbol was added or removed).
 */
export function blockProgress(data: LoadedPr, verdicts: Record<string, Verdict>): BlockProgress {
  const states: Record<number, BlockState> = {}
  const stale: Record<number, string> = {}
  const unmatched = Object.entries(verdicts).filter(([key]) => ![...data.blocks.values()].some((b) => b.key === key))
  for (const b of data.blocks.values()) {
    const v = verdicts[b.key]
    if (v && v.hash === b.contentHash) states[b.id] = v.state
    else if (v) stale[b.id] = v.head
    else {
      const files = new Set(b.files)
      const overlap = (fs: string[]) => fs.filter((f) => files.has(f)).length / Math.max(files.size, fs.length, 1)
      const prior = unmatched.map(([, v]) => v).find((v) => overlap(v.files) >= 0.5)
      if (prior) stale[b.id] = prior.head
    }
  }
  return { states, stale }
}
