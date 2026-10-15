import { useEffect, useReducer, useRef } from 'react'
import { reviewApi } from '../api'
import type { BlockState, LoadedPr, Mode, ReviewComment } from '../model/types'

/** A file marked viewed, tied to the diff that was viewed. */
export interface Viewed {
  /** `FilePatch.hash` when viewed; empty when carried over from older progress and not yet pinned. */
  hash: string
  head: string
}

export interface ReviewState {
  v: 3
  mode: Mode
  currentFile: string | null
  viewed: Record<string, Viewed>
  comments: ReviewComment[]
}

export type ReviewAction =
  | { type: 'mode'; mode: Mode }
  | { type: 'go'; file: string }
  | { type: 'view'; files: string[]; viewed: Viewed[] | null }
  | { type: 'comment'; comment: ReviewComment }
  | { type: 'deleteComment'; id: string }
  | { type: 'posted'; ids: string[] }

function reducer(s: ReviewState, a: ReviewAction): ReviewState {
  switch (a.type) {
    case 'mode':
      return { ...s, mode: a.mode }
    case 'go':
      return s.currentFile === a.file ? s : { ...s, currentFile: a.file }
    case 'view': {
      const viewed = { ...s.viewed }
      a.files.forEach((f, i) => {
        if (a.viewed) viewed[f] = a.viewed[i]
        else delete viewed[f]
      })
      return { ...s, viewed }
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

interface BlockVerdict {
  state: BlockState
  hash: string
  head: string
}

/** Progress saved before files were the unit: a file counts as viewed when every block touching it was reviewed unchanged. */
function fromBlocks(saved: { mode: Mode; verdicts?: Record<string, BlockVerdict>; comments?: ReviewComment[] }, data: LoadedPr): ReviewState {
  const ok = new Set([...data.blocks.values()].filter((b) => saved.verdicts?.[b.key]?.hash === b.contentHash).map((b) => b.id))
  const viewed: Record<string, Viewed> = {}
  const head = data.pr?.headSha ?? ''
  const files = new Set([...data.blocks.values()].flatMap((b) => b.files))
  for (const f of files) if ([...data.blocks.values()].filter((b) => b.files.includes(f)).every((b) => ok.has(b.id))) viewed[f] = { hash: '', head }
  return { v: 3, mode: saved.mode, currentFile: null, viewed, comments: saved.comments ?? [] }
}

/**
 * Review progress, saved in Grain's data folder so it survives browser changes and restarts.
 * Progress that only exists in this browser (from before) is imported once.
 */
export function useReviewState(data: LoadedPr, defaultMode: Mode) {
  const legacyKey = `grain:review:${data.id}`
  const [state, dispatch] = useReducer(reducer, undefined, (): ReviewState => {
    const fromServer = data.progress as { v?: number } | null
    let saved = fromServer
    try {
      saved ??= JSON.parse(localStorage.getItem(legacyKey) ?? 'null')
    } catch {
      // Unreadable saved state starts a fresh review.
    }
    if (saved?.v === 3) return saved as ReviewState
    if (saved?.v === 2) return fromBlocks(saved as Parameters<typeof fromBlocks>[0], data)
    return { v: 3, mode: (saved as { mode?: Mode } | null)?.mode ?? defaultMode, currentFile: null, viewed: {}, comments: [] }
  })
  const first = useRef(true)
  useEffect(() => {
    // The first save also imports browser-only progress; later saves are debounced.
    const delay = first.current ? 0 : 400
    first.current = false
    const t = setTimeout(
      () =>
        reviewApi.saveProgress(data.id, state).then(
          () => localStorage.removeItem(legacyKey),
          () => localStorage.setItem(legacyKey, JSON.stringify(state)),
        ),
      delay,
    )
    return () => clearTimeout(t)
  }, [data.id, legacyKey, state])
  return [state, dispatch] as const
}
