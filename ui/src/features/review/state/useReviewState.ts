import { useEffect, useReducer } from 'react'
import type { BlockState, LoadedPr, Mode, ReviewComment } from '../model/types'

/** A verdict on one block, tied to the exact content that was reviewed. */
export interface Verdict {
  state: BlockState
  /** `Block.contentHash` when reviewed; a different hash means the block changed since. */
  hash: string
  /** Head commit when reviewed, for "what changed since your review". */
  head: string
  files: string[]
}

export interface ReviewState {
  v: 2
  mode: Mode
  /** Key of the block being read. */
  currentKey: string | null
  /** Verdicts by block key, so they survive regrouping and new pushes. */
  verdicts: Record<string, Verdict>
  comments: ReviewComment[]
}

export type ReviewAction =
  | { type: 'mode'; mode: Mode }
  | { type: 'go'; key: string }
  | { type: 'mark'; key: string; verdict: Verdict | null }
  | { type: 'comment'; comment: ReviewComment }
  | { type: 'deleteComment'; id: string }
  | { type: 'posted'; ids: string[] }

function reducer(s: ReviewState, a: ReviewAction): ReviewState {
  switch (a.type) {
    case 'mode':
      return { ...s, mode: a.mode }
    case 'go':
      return { ...s, currentKey: a.key }
    case 'mark': {
      const verdicts = { ...s.verdicts }
      if (a.verdict) verdicts[a.key] = a.verdict
      else delete verdicts[a.key]
      return { ...s, verdicts }
    }
    case 'comment':
      return { ...s, comments: [...s.comments, a.comment] }
    case 'deleteComment':
      return { ...s, comments: s.comments.filter((c) => c.id !== a.id) }
    case 'posted': {
      const at = Date.now()
      return { ...s, comments: s.comments.map((c) => (a.ids.includes(c.id) ? { ...c, postedAt: at } : c)) }
    }
  }
}

interface LegacyState {
  mode: Mode
  current: number | null
  states: Record<number, BlockState>
  comments: ReviewComment[]
}

/** Converts progress saved by block number (before keys existed) using the current review. */
function migrate(saved: LegacyState, data: LoadedPr): ReviewState {
  const head = data.pr?.headSha ?? ''
  const verdicts: Record<string, Verdict> = {}
  for (const [id, state] of Object.entries(saved.states ?? {})) {
    const b = data.blocks.get(Number(id))
    if (b) verdicts[b.key] = { state, hash: b.contentHash, head, files: b.files }
  }
  const currentKey = saved.current ? (data.blocks.get(saved.current)?.key ?? null) : null
  const comments = (saved.comments ?? []).map((c) => ({ ...c, blockKey: c.blockKey ?? data.blocks.get(c.blockId)?.key ?? '' }))
  return { v: 2, mode: saved.mode, currentKey, verdicts, comments }
}

/** Review progress persisted per PR in localStorage, so closing the tab never loses work. */
export function useReviewState(data: LoadedPr, defaultMode: Mode) {
  const key = `grain:review:${data.id}`
  const [state, dispatch] = useReducer(reducer, undefined, (): ReviewState => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (saved?.v === 2) return saved as ReviewState
      if (saved) return migrate(saved as LegacyState, data)
    } catch {
      // Unreadable saved state starts a fresh review.
    }
    return { v: 2, mode: defaultMode, currentKey: null, verdicts: {}, comments: [] }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])
  return [state, dispatch] as const
}
