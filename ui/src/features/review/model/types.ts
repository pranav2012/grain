import type { Agent } from '@/types/generated/Agent'
import type { Block } from '@/types/generated/Block'
import type { LayerSummary } from '@/types/generated/LayerSummary'
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
  /** Replacement for the commented new-code lines, posted as a GitHub suggestion. */
  suggestion?: string
  /** Set once the comment was posted to GitHub; posted comments are never sent again. */
  postedAt?: number
}

/** `pr.json`: GitHub details plus what the server knows about this review. */
export type PrMeta = PrDetails & {
  viewer?: string
  agent?: Agent | null
  mergeBase?: string | null
  /** Set for self-reviews of local changes: the folder, its branch and the branch it's compared with. */
  local?: { path: string; branch: string | null; base: string | null } | null
}

/** `owners.json`: CODEOWNERS for the changed files, from the PR's base. */
export interface Owners {
  /** Which CODEOWNERS file was used; null when the repository has none. */
  source: string | null
  files: Record<string, string[]>
  /** Changed files the reviewer owns, directly or through a team. */
  mine: string[]
}

export interface LoadedPr {
  /** `owner/repo/123` */
  id: string
  review: Review
  /** Agent summaries keyed by block content key, and layer summaries by `layer:` + layer key. */
  summaries: Record<string, Summary | LayerSummary>
  pr: PrMeta | null
  /** Review progress saved on the server (shape owned by `useReviewState`), if any. */
  progress: unknown
  owners: Owners
  blocks: Map<number, Block>
}

/** A question to the agent about one change, and its answer once it arrives. */
export interface Ask {
  id: string
  question: string
  /** Which lines it was about, when asked from a selection. */
  about?: string
  answer?: string
  error?: string
}

/** A conversation with the agent anchored at one line of the diff. */
export interface LineThread {
  id: string
  blockId: number
  file: string
  side: Side
  /** 1-based line the thread sits under. */
  line: number
  /** What was asked about: `fetchVoucher` or `VoucherBody.tsx:12–18`. */
  about: string
  /** The code the questions are about, sent with each question. */
  code?: string
  messages: Ask[]
  open: boolean
}
