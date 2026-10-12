import { type KeyboardEvent, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import type { CommentKind } from '../model/types'

interface ComposerProps {
  kinds: [CommentKind, string][]
  initialKind?: CommentKind
  initialBody?: string
  placeholder?: string
  /** The selected new-code lines; when set, the comment can carry a suggested replacement. */
  suggestionSeed?: string | null
  onSave(body: string, kind: CommentKind, suggestion?: string): void
  onCancel(): void
}

export function Composer({ kinds, initialKind, initialBody, placeholder, suggestionSeed, onSave, onCancel }: ComposerProps) {
  const [body, setBody] = useState(initialBody ?? '')
  const [kind, setKind] = useState<CommentKind>(initialKind ?? kinds[0][0])
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const changed = suggestion !== null && suggestion !== suggestionSeed
  const canSave = !!body.trim() || changed
  const save = () => canSave && onSave(body.trim(), kind, changed ? suggestion : undefined)
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
    if (e.key === 'Escape') onCancel()
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-2 shadow-float">
      <textarea
        autoFocus
        value={body}
        placeholder={suggestion !== null ? 'Why this change? (optional)' : (placeholder ?? 'Write a comment')}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={keys}
        className="min-h-16 resize-y bg-transparent leading-normal outline-none"
      />
      {suggestion !== null && (
        <div className="rounded-md border border-line bg-canvas">
          <div className="flex items-center border-b border-line px-2 py-1 text-xs text-fg-subtle">
            Suggested code
            <LinkButton onClick={() => setSuggestion(null)} className="ml-auto">
              Remove
            </LinkButton>
          </div>
          <textarea
            autoFocus
            value={suggestion}
            spellCheck={false}
            onChange={(e) => setSuggestion(e.target.value)}
            onKeyDown={keys}
            rows={Math.min(14, suggestion.split('\n').length + 1)}
            className="w-full resize-y bg-transparent p-2 font-mono text-sm leading-normal whitespace-pre outline-none"
          />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {kinds.map(([k, label]) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className="rounded-full border border-line px-2 py-0.5 text-xs text-fg-subtle hover:text-fg aria-pressed:border-fg-subtle aria-pressed:bg-raised aria-pressed:text-fg"
          >
            {label}
          </button>
        ))}
        {suggestionSeed != null && suggestion === null && (
          <button
            onClick={() => setSuggestion(suggestionSeed)}
            title="Propose replacement code the author can apply in one click"
            className="rounded-full border border-dashed border-line px-2 py-0.5 text-xs text-fg-subtle hover:text-fg"
          >
            ± Suggest change
          </button>
        )}
        <span className="ml-auto" />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!canSave}>
          Save <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  )
}
