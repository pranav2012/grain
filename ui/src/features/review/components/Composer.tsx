import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import type { CommentKind } from '../model/types'

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
    <div className="flex flex-col gap-2 rounded-lg border border-periwinkle bg-slate p-2">
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
        className="min-h-16 resize-y bg-transparent leading-normal outline-none"
      />
      <div className="flex items-center gap-1.5">
        {kinds.map(([k, label]) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className="rounded-full border border-seam px-[9px] py-[3px] text-xs text-fog aria-pressed:border-fog aria-pressed:text-chalk"
          >
            {label}
          </button>
        ))}
        <span className="ml-auto" />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!body.trim()}>
          Save <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  )
}
