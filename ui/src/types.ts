export type Risk = 'low' | 'medium' | 'high'
export type Mode = 'self' | 'peer' | 'maintainer'
export type Side = 'additions' | 'deletions'

export interface Block {
  id: number
  lines: number
  files: string[]
  entities: string[]
  residue_files: string[]
  mechanical_entities: number
  has_tests: boolean
  kind: string
  skim: string | null
  layer: number
  dir: string
}

export interface Chapter {
  id: number
  title: string
  dir: string
  lines: number
  layer: number
  blocks: number[]
}

export interface Review {
  chapters: Chapter[]
  skim: number[]
  blocks: Block[]
  totalLines: number
}

export interface Summary {
  title: string
  intent: string
  risk: Risk
  risk_reasons: string[]
  reviewer_questions: string[]
}

export interface PrMeta {
  number: number
  title: string
  url: string
  author: { login: string }
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  changedFiles: number
}

export type CommentKind = 'comment' | 'question' | 'change' | 'note' | 'fix'

export interface ReviewComment {
  id: string
  blockId: number
  body: string
  kind: CommentKind
  file?: string
  side?: Side
  line?: number
  endLine?: number
  createdAt: number
}

/** Reviewer's verdict on one block. */
export type BlockState = 'ok' | 'change'
