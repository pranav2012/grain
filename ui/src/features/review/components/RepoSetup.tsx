import { useEffect, useState } from 'react'
import { Button, LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DialogActions, DialogTitle } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { pickFolder } from '@/lib/pick-folder'
import { reviewApi } from '../api'

/**
 * Asked once per repository, only when Grain can't find exactly one clone by itself: borrow from
 * the reviewer's existing clone (their repo is never modified) or download a read-only copy.
 */
export function RepoSetup({ fullRepo, onDone }: { fullRepo: string; onDone(): void }) {
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [path, setPath] = useState('')
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'picking' | 'saving' | null>(null)
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
    setBusy('saving')
    setError(null)
    reviewApi.setLocalRepo(fullRepo, p).then(onDone, (e: Error) => {
      setError(e.message)
      setBusy(null)
    })
  }
  const choose = () => {
    setBusy('picking')
    setError(null)
    pickFolder(`Choose your clone of ${fullRepo}`).then(
      (p) => (p ? save(p) : setBusy(null)),
      (e: Error) => {
        setError(e.message)
        setTyping(true)
        setBusy(null)
      },
    )
  }

  return (
    <Card className="w-[min(560px,92vw)] rounded-xl p-5 text-left">
      <DialogTitle>Do you already have {fullRepo} on this computer?</DialogTitle>
      <p className="mb-3.5 leading-relaxed text-fg-subtle">
        Grain can reuse your clone's files instead of downloading another copy, which makes big pull requests open much faster. Your repository is
        only read, never changed. You'll only be asked once.
      </p>
      {candidates === null ? (
        <p className="text-fg-subtle">Looking for it in your work folders…</p>
      ) : (
        candidates.length > 0 && (
          <div className="mb-2.5 flex flex-col gap-1.5">
            <p className="text-sm text-fg-subtle">Found {candidates.length} copies. Pick the one to use:</p>
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
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={choose} disabled={busy !== null}>
          {busy === 'picking' ? 'Waiting for you to pick a folder…' : 'Choose folder…'}
        </Button>
        {!typing && <LinkButton onClick={() => setTyping(true)}>Type a path instead</LinkButton>}
      </div>
      {typing && (
        <Input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && path.trim() && save(path)}
          placeholder={`Path to your clone, e.g. ~/code/${fullRepo.split('/')[1]}`}
          className="mt-2.5 w-full font-mono text-xs"
        />
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      <p className="mt-3 text-sm text-fg-faint">Tip: add the folder you keep your code in under Settings → Work folders, and Grain will find clones there without asking.</p>
      <DialogActions>
        <Button onClick={() => save(null)} disabled={busy !== null}>
          No, download a copy
        </Button>
        {(typing || (candidates?.length ?? 0) > 0) && (
          <Button variant="primary" onClick={() => save(path)} disabled={busy !== null || !path.trim()}>
            Use this folder
          </Button>
        )}
      </DialogActions>
    </Card>
  )
}
