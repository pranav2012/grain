import { useEffect, useReducer } from 'react'
import type { BlockState, Mode, ReviewComment } from './types'

export interface ReviewState {
  mode: Mode
  current: number | null
  states: Record<number, BlockState>
  comments: ReviewComment[]
}

export type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'go'; id: number }
  | { type: 'mark'; id: number; state: BlockState | null }
  | { type: 'comment'; comment: ReviewComment }
  | { type: 'deleteComment'; id: string }

function reducer(s: ReviewState, a: Action): ReviewState {
  switch (a.type) {
    case 'mode':
      return { ...s, mode: a.mode }
    case 'go':
      return { ...s, current: a.id }
    case 'mark': {
      const states = { ...s.states }
      if (a.state) states[a.id] = a.state
      else delete states[a.id]
      return { ...s, states }
    }
    case 'comment':
      return { ...s, comments: [...s.comments, a.comment] }
    case 'deleteComment':
      return { ...s, comments: s.comments.filter((c) => c.id !== a.id) }
  }
}

/** Review progress persisted per PR in localStorage, so closing the tab never loses work. */
export function useReviewState(prName: string, defaultMode: Mode) {
  const key = `grain:review:${prName}`
  const [state, dispatch] = useReducer(reducer, undefined, (): ReviewState => {
    try {
      const saved = localStorage.getItem(key)
      if (saved) return JSON.parse(saved) as ReviewState
    } catch {
      /* corrupted state starts fresh */
    }
    return { mode: defaultMode, current: null, states: {}, comments: [] }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])
  return [state, dispatch] as const
}
