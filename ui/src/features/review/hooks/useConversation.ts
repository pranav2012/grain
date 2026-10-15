import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Conversation } from '@/types/generated/Conversation'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { reviewApi } from '../api'
import type { LoadedPr } from '../model/types'

/** Sent to GitHub immediately, like GitHub's own Reply and Resolve buttons. */
export interface ThreadActions {
  reply(threadId: string, body: string): Promise<void>
  setResolved(threadId: string, resolved: boolean): Promise<void>
}

export const ThreadActionsContext = createContext<ThreadActions | null>(null)
export const useThreadActions = () => useContext(ThreadActionsContext)

/** Existing GitHub review threads, grouped by block: the saved copy at once, then a fresh one. */
export function useConversation(data: LoadedPr) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  useEffect(() => {
    let alive = true
    let live = false
    reviewApi.savedConversation(data.id).then(
      (saved) => alive && !live && saved && setConversation(saved.conversation),
      () => {},
    )
    reviewApi.conversation(data.id).then(
      (c) => {
        if (!alive) return
        live = true
        setConversation((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c))
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [data.id])
  const byBlock = useMemo(() => {
    const map = new Map<number, ReviewThread[]>()
    if (!conversation) return map
    for (const b of data.blocks.values()) {
      const files = new Set(b.files)
      const threads = conversation.threads.filter((t) => files.has(t.path))
      if (threads.length) map.set(b.id, threads)
    }
    return map
  }, [conversation, data.blocks])

  const update = useCallback((threadId: string, f: (t: ReviewThread) => ReviewThread) => {
    setConversation((c) => c && { ...c, threads: c.threads.map((t) => (t.id === threadId ? f(t) : t)) })
  }, [])
  const actions = useMemo<ThreadActions>(
    () => ({
      reply: async (threadId, body) => {
        const comment = await reviewApi.replyToThread(data.id, threadId, body)
        update(threadId, (t) => ({ ...t, comments: [...t.comments, comment] }))
      },
      setResolved: async (threadId, resolved) => {
        const r = await reviewApi.resolveThread(data.id, threadId, resolved)
        update(threadId, (t) => ({ ...t, resolved: r.resolved, canResolve: !r.resolved, canUnresolve: r.resolved }))
      },
    }),
    [data.id, update],
  )
  return { conversation, actions, threadsFor: (blockId: number) => byBlock.get(blockId) ?? [] }
}
