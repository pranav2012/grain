import type { Agent } from '@/types/generated/Agent'
import type { Block } from '@/types/generated/Block'
import type { PrDetails } from '@/types/generated/PrDetails'
import type { Review } from '@/types/generated/Review'
import type { Summary } from '@/types/generated/Summary'

export type Mode = 'self' | 'peer' | 'maintainer'
export type Side = 'additions' | 'deletions'
export type DiffStyle = 'unified' | 'split'
/** Reviewer's verdict on one block. */
export type BlockState = 'ok' | 'change'
export type CommentKind = 'comment' | 'question' | 'change' | 'note' | 'fix'

export interface ReviewComment {
  id: string
  /** Block number when written (display only; numbers change between pushes). */
  blockId: number
  /** Stable block identity; comments follow their block across pushes. */
  blockKey: string
  body: string
  kind: CommentKind
  file?: string
  side?: Side
  line?: number
  endLine?: number
  createdAt: number
  /** Set once the comment was posted to GitHub; posted comments are never sent again. */
  postedAt?: number
}

/** `pr.json`: GitHub details plus what the server knows about this review. */
export type PrMeta = PrDetails & { viewer?: string; agent?: Agent | null; mergeBase?: string | null }

export interface LoadedPr {
  /** `owner/repo/123` */
  id: string
  review: Review
  /** Agent summaries keyed by block content key. */
  summaries: Record<string, Summary>
  pr: PrMeta | null
  /** Review progress saved on the server (shape owned by `useReviewState`), if any. */
  progress: unknown
  blocks: Map<number, Block>
}

export interface Section {
  key: string
  title: string
  chapterId?: number
  blocks: number[]
}
