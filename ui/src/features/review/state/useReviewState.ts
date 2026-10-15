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
  /** The reviewer's call on each AI finding, by `findingKey`: kept as a draft comment (its id) or dismissed. */
  ai?: Record<string, { kept: string } | 'dismissed'>
}

export type ReviewAction =
  | { type: 'mode'; mode: Mode }
  | { type: 'go'; file: string }
  | { type: 'view'; files: string[]; viewed: Viewed[] | null }
  | { type: 'comment'; comment: ReviewComment }
  | { type: 'deleteComment'; id: string }
  | { type: 'editComment'; id: string; body: string; kind: ReviewComment['kind']; suggestion?: string }
  | { type: 'posted'; ids: string[] }
  | { type: 'ai'; key: string; call: { kept: string } | 'dismissed' | null }

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
    case 'editComment':
      return { ...s, comments: s.comments.map((c) => (c.id === a.id && !c.postedAt ? { ...c, body: a.body, kind: a.kind, suggestion: a.suggestion } : c)) }
    case 'ai': {
      const ai = { ...s.ai }
      if (a.call) ai[a.key] = a.call
      else delete ai[a.key]
      return { ...s, ai }
    }
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
 * Review progress, saved in Grain's data folder so it survives browser changes and restarts. Until
 * the server confirms a save, the progress is also kept in this browser (and retried), so nothing is
 * lost while Grain is stopped or restarting; that copy wins on the next load.
 */
export function useReviewState(data: LoadedPr, defaultMode: Mode) {
  const localKey = `grain:review:${data.id}`
  const [state, dispatch] = useReducer(reducer, undefined, (): ReviewState => {
    let saved = null as { v?: number } | null
    try {
      saved = JSON.parse(localStorage.getItem(localKey) ?? 'null')
    } catch {
      // Unreadable browser copy: use the server's.
    }
    saved ??= data.progress as { v?: number } | null
    if (saved?.v === 3) return saved as ReviewState
    if (saved?.v === 2) return fromBlocks(saved as Parameters<typeof fromBlocks>[0], data)
    return { v: 3, mode: (saved as { mode?: Mode } | null)?.mode ?? defaultMode, currentFile: null, viewed: {}, comments: [] }
  })
  const first = useRef(true)
  useEffect(() => {
    localStorage.setItem(localKey, JSON.stringify(state))
    const delay = first.current ? 0 : 400
    first.current = false
    let stale = false
    let t: ReturnType<typeof setTimeout>
    const save = () =>
      reviewApi.saveProgress(data.id, state).then(
        () => !stale && localStorage.removeItem(localKey),
        () => {
          if (!stale) t = setTimeout(save, 3000)
        },
      )
    t = setTimeout(save, delay)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [data.id, localKey, state])
  return [state, dispatch] as const
}
