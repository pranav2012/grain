import { useMemo, useState } from 'react'
import type { CodeViewItem, DiffLineAnnotation } from '@pierre/diffs'
import { CodeView, type CodeViewReactOptions } from '@pierre/diffs/react'
import type { LoadedPr } from '../data'
import { blockTitle, formatMinutes, minutesFor } from '../data'
import { modes } from '../modes'
import type { Block, BlockState, CommentKind, Mode, ReviewComment, Side } from '../types'
import { CommentCard, Composer } from './Composer'
import { Inline } from './Inline'

type Note = { draft: true } | { draft: false; id: string }

interface Draft {
  file: string
  side: Side
  line: number
  endLine: number
}

interface Props {
  data: LoadedPr
  block: Block
  mode: Mode
  chapterTitle: string
  position: string
  state?: BlockState
  comments: ReviewComment[]
  onPrimary(): void
  onSecondary(): void
  onComment(c: Omit<ReviewComment, 'id' | 'createdAt' | 'blockId'>): void
  onDeleteComment(id: string): void
}

const options: CodeViewReactOptions<Note, undefined> = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'dark',
  diffStyle: 'unified',
  stickyHeaders: true,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
  unsafeCSS: '* { --diffs-dark-bg: #16181d !important; }',
}

export function BlockView(p: Props) {
  const { data, block, mode } = p
  const copy = modes[mode]
  const summary = data.summaries[String(block.id)]
  const [draft, setDraft] = useState<Draft | null>(null)

  const items = useMemo<CodeViewItem<Note>[]>(() => {
    return block.files
      .map((f) => data.files.get(f))
      .filter((f) => !!f)
      .map((fileDiff) => {
        const annotations: DiffLineAnnotation<Note>[] = p.comments
          .filter((c) => c.file === fileDiff.name && c.line)
          .map((c) => ({ side: c.side ?? 'additions', lineNumber: c.endLine ?? c.line!, metadata: { draft: false, id: c.id } }))
        if (draft?.file === fileDiff.name) annotations.push({ side: draft.side, lineNumber: draft.endLine, metadata: { draft: true } })
        return { id: fileDiff.name, type: 'diff', fileDiff, annotations, version: annotations.length * 2 + (draft ? 1 : 0) }
      })
  }, [block, data.files, p.comments, draft])

  const missing = block.files.length - items.length

  return (
    <main className="main">
      <header className="block-head">
        <div className="crumb">
          <span>{p.chapterTitle}</span>
          <span aria-hidden>/</span>
          <span>{p.position}</span>
        </div>
        <h1 className="block-title">{blockTitle(data, block)}</h1>
        {summary?.intent ? (
          <p className="intent">
            <Inline text={summary.intent} />
          </p>
        ) : (
          !block.skim && <p className="intent muted">Not summarized yet. Your agent summarizes blocks just ahead of where you're reading.</p>
        )}
        <div className="facts">
          {summary?.risk && <span className={`risk ${summary.risk}`}>{summary.risk[0].toUpperCase() + summary.risk.slice(1)} risk</span>}
          <span>
            {block.lines} changed lines in {block.files.length} {block.files.length === 1 ? 'file' : 'files'}
          </span>
          {block.has_tests && <span>Includes tests</span>}
          {block.skim && <span>Low attention: skim and confirm</span>}
          <span>About {formatMinutes(minutesFor(block.lines))}</span>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={p.onPrimary}>
            {p.state === 'ok' ? 'Reviewed' : copy.primary} <kbd>space</kbd>
          </button>
          <button className="btn danger" onClick={p.onSecondary}>
            {copy.secondary} <kbd>x</kbd>
          </button>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="empty">This block only renames or moves files. There are no line changes to show.</div>
      ) : (
        <CodeView<Note, undefined>
          key={block.id}
          className="diff"
          items={items}
          options={options}
          selectedLines={draft ? { id: draft.file, range: { start: draft.line, end: draft.endLine, side: draft.side } } : null}
          onSelectedLinesChange={(sel) => {
            if (!sel) return
            const side = (sel.range.endSide ?? sel.range.side ?? 'additions') as Side
            setDraft({ file: sel.id, side, line: Math.min(sel.range.start, sel.range.end), endLine: Math.max(sel.range.start, sel.range.end) })
          }}
          renderAnnotation={(a) => {
            const meta = a.metadata
            if (!meta) return null
            if (meta.draft && draft)
              return (
                <div className="inline-thread">
                  <Composer
                    kinds={copy.kinds}
                    placeholder={`Comment on line ${draft.line}${draft.endLine !== draft.line ? `–${draft.endLine}` : ''}`}
                    onCancel={() => setDraft(null)}
                    onSave={(body: string, kind: CommentKind) => {
                      p.onComment({ body, kind, file: draft.file, side: draft.side, line: draft.line, endLine: draft.endLine })
                      setDraft(null)
                    }}
                  />
                </div>
              )
            const c = !meta.draft && p.comments.find((x) => x.id === meta.id)
            return c ? (
              <div className="inline-thread">
                <CommentCard c={c} onDelete={() => p.onDeleteComment(c.id)} />
              </div>
            ) : null
          }}
        />
      )}
      {missing > 0 && items.length > 0 && <div className="attribution">{missing} binary or unchanged files not shown.</div>}
    </main>
  )
}
