import { useEffect, useMemo, useState } from 'react'
import type { Conversation } from '@/types/generated/Conversation'
import type { ReviewThread } from '@/types/generated/ReviewThread'
import { reviewApi } from '../api'
import type { LoadedPr } from '../model/types'

/** Existing GitHub review threads, fetched once per open review and grouped by block. */
export function useConversation(data: LoadedPr) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  useEffect(() => {
    let alive = true
    reviewApi.conversation(data.id).then(
      (c) => alive && setConversation(c),
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
  return { conversation, threadsFor: (blockId: number) => byBlock.get(blockId) ?? [] }
}
