import type { CommentKind, Mode } from './types'

export interface ModeCopy {
  label: string
  order: string
  primary: string
  secondary: string
  secondaryKind: CommentKind
  kinds: [CommentKind, string][]
  finish: string
}

export const modes: Record<Mode, ModeCopy> = {
  self: {
    label: 'Self review',
    order: 'Riskiest first',
    primary: 'Looks good',
    secondary: 'Ask agent to fix',
    secondaryKind: 'fix',
    kinds: [
      ['note', 'Note'],
      ['fix', 'Ask agent to fix'],
    ],
    finish: 'Finish review',
  },
  peer: {
    label: 'Peer review',
    order: 'Foundations first',
    primary: 'Mark reviewed',
    secondary: 'Request change',
    secondaryKind: 'change',
    kinds: [
      ['comment', 'Comment'],
      ['question', 'Question'],
      ['change', 'Request change'],
    ],
    finish: 'Submit review',
  },
  maintainer: {
    label: 'Maintainer',
    order: 'Riskiest first',
    primary: 'Approve block',
    secondary: 'Request change',
    secondaryKind: 'change',
    kinds: [
      ['comment', 'Comment'],
      ['change', 'Request change'],
    ],
    finish: 'Make decision',
  },
}

export const modeOrder: Mode[] = ['self', 'peer', 'maintainer']

export const kindLabel: Record<CommentKind, string> = {
  comment: 'Comment',
  question: 'Question',
  change: 'Change requested',
  note: 'Note',
  fix: 'Fix for agent',
}
