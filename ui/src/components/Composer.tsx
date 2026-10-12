import { useState } from 'react'
import { kindLabel } from '../modes'
import type { CommentKind, ReviewComment } from '../types'

interface ComposerProps {
  kinds: [CommentKind, string][]
  initialKind?: CommentKind
  placeholder?: string
  onSave(body: string, kind: CommentKind): void
  onCancel(): void
}

export function Composer({ kinds, initialKind, placeholder, onSave, onCancel }: ComposerProps) {
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<CommentKind>(initialKind ?? kinds[0][0])
  const save = () => body.trim() && onSave(body.trim(), kind)
  return (
    <div className="composer">
      <textarea
        autoFocus
        value={body}
        placeholder={placeholder ?? 'Write a comment'}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="bar">
        {kinds.map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }} />
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={!body.trim()}>
          Save <kbd>⌘↵</kbd>
        </button>
      </div>
    </div>
  )
}

export function CommentCard({ c, onDelete }: { c: ReviewComment; onDelete(): void }) {
  return (
    <div className="comment">
      <div className="meta">
        <span className={`kind ${c.kind}`}>{kindLabel[c.kind]}</span>
        {c.file && (
          <span>
            {c.file.split('/').pop()}:{c.line}
            {c.endLine && c.endLine !== c.line ? `–${c.endLine}` : ''}
          </span>
        )}
        <button className="link" style={{ marginLeft: 'auto' }} onClick={onDelete}>
          Delete
        </button>
      </div>
      {c.body}
    </div>
  )
}
