import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DialogActions, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { reviewApi } from '../api'

/**
 * Asked once per repository: borrow from the reviewer's existing clone (their repo is never
 * modified) or download a read-only copy.
 */
export function RepoSetup({ fullRepo, onDone }: { fullRepo: string; onDone(): void }) {
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    reviewApi.localRepo(fullRepo).then(
      (r) => {
        setCandidates(r.candidates)
        if (r.candidates[0]) setPath(r.candidates[0])
      },
      () => setCandidates([]),
    )
  }, [fullRepo])
  const save = (p: string | null) => {
    setSaving(true)
    setError(null)
    reviewApi.setLocalRepo(fullRepo, p).then(onDone, (e: Error) => {
      setError(e.message)
      setSaving(false)
    })
  }

  return (
    <Card className="w-[min(560px,92vw)] rounded-xl p-5 text-left">
      <DialogTitle>Do you already have {fullRepo} on this computer?</DialogTitle>
      <p className="mb-3.5 leading-relaxed text-fg-subtle">
        Grain can reuse your clone's files instead of downloading another copy, which makes big pull requests open much faster. Your repository is
        only read, never changed. You'll only be asked once.
      </p>
      {candidates === null ? (
        <p className="text-fg-subtle">Looking for it in your usual code folders…</p>
      ) : (
        candidates.length > 0 && (
          <div className="mb-2.5 flex flex-col gap-1.5">
            {candidates.map((c) => (
              <button
                key={c}
                onClick={() => setPath(c)}
                aria-pressed={path === c}
                className="truncate rounded-lg border border-line px-3 py-2 text-left font-mono text-xs text-fg-subtle hover:bg-raised aria-pressed:border-fg-subtle aria-pressed:bg-raised aria-pressed:text-fg"
              >
                {c}
              </button>
            ))}
          </div>
        )
      )}
      <Input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && path.trim() && save(path)}
        placeholder={`Path to your clone, e.g. ~/code/${fullRepo.split('/')[1]}`}
        className="w-full font-mono text-xs"
      />
      {error && <p className="mt-2 text-danger">{error}</p>}
      <DialogActions>
        <Button onClick={() => save(null)} disabled={saving}>
          No, download a copy
        </Button>
        <Button variant="primary" onClick={() => save(path)} disabled={saving || !path.trim()}>
          Use this folder
        </Button>
      </DialogActions>
    </Card>
  )
}
