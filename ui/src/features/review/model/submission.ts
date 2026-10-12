import type { LineComment } from '@/types/generated/LineComment'
import type { ReviewEvent } from '@/types/generated/ReviewEvent'
import type { SubmitRequest } from '@/types/generated/SubmitRequest'
import { blockTitle } from './describe'
import { kindLabel } from './modes'
import type { LoadedPr, ReviewComment } from './types'

const prefix = (c: ReviewComment) => (c.kind === 'comment' || c.kind === 'note' ? '' : `**${kindLabel[c.kind]}:** `)

/**
 * One GitHub review from the reviewer's unposted comments: line comments are anchored to the
 * diff; notes on whole blocks go into the review text, grouped by block.
 */
export function buildSubmission(data: LoadedPr, comments: ReviewComment[], event: ReviewEvent, overall: string, dryRun: boolean): SubmitRequest {
  const unposted = comments.filter((c) => !c.postedAt)
  const lineComments: LineComment[] = unposted
    .filter((c) => c.file && c.line)
    .map((c) => ({
      path: c.file!,
      line: c.endLine ?? c.line!,
      startLine: c.endLine && c.endLine !== c.line ? c.line! : null,
      side: c.side === 'deletions' ? 'LEFT' : 'RIGHT',
      body: prefix(c) + c.body,
    }))
  const byBlock = new Map<number, ReviewComment[]>()
  for (const c of unposted.filter((c) => !c.file)) byBlock.set(c.blockId, [...(byBlock.get(c.blockId) ?? []), c])
  const sections = [...byBlock].map(([id, cs]) => {
    const b = data.blocks.get(id)
    const title = b ? blockTitle(data, b) : 'Earlier version of this PR'
    return `**${title}**\n${cs.map((c) => `- ${prefix(c)}${c.body}`).join('\n')}`
  })
  const body = [overall.trim(), ...sections].filter(Boolean).join('\n\n')
  return { event, body, comments: lineComments, commitId: data.pr?.headSha ?? '', dryRun }
}
