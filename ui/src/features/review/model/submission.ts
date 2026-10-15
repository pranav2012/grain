import type { LineComment } from '@/types/generated/LineComment'
import type { ReviewEvent } from '@/types/generated/ReviewEvent'
import type { SubmitRequest } from '@/types/generated/SubmitRequest'
import { kindLabel } from './modes'
import { suggestionBlock } from './suggestion'
import type { LoadedPr, ReviewComment } from './types'

const prefix = (c: ReviewComment) => (c.kind === 'comment' || c.kind === 'note' ? '' : `**${kindLabel[c.kind]}:** `)

/**
 * One GitHub review from the reviewer's unposted comments: line comments are anchored to the
 * diff; notes on whole files go into the review text, grouped by file.
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
      body: [prefix(c) + c.body, c.suggestion !== undefined && c.side !== 'deletions' ? suggestionBlock(c.suggestion) : '']
        .filter(Boolean)
        .join('\n\n'),
    }))
  const byFile = new Map<string, ReviewComment[]>()
  for (const c of unposted.filter((c) => !c.line)) byFile.set(c.file ?? '', [...(byFile.get(c.file ?? '') ?? []), c])
  const sections = [...byFile].map(([file, cs]) => {
    const title = file ? `\`${file}\`` : 'Whole change'
    return `**${title}**\n${cs.map((c) => `- ${prefix(c)}${c.body}`).join('\n')}`
  })
  const body = [overall.trim(), ...sections].filter(Boolean).join('\n\n')
  return { event, body, comments: lineComments, commitId: data.pr?.headSha ?? '', dryRun }
}
