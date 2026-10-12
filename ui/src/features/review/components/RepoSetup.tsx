import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
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
    <div className="w-[min(560px,92vw)] rounded-xl border border-seam bg-slate p-5 text-left">
      <h2 className="mb-1 text-[17px] font-semibold text-chalk">Do you already have {fullRepo} on this computer?</h2>
      <p className="mb-3.5 leading-relaxed text-fog">
        Grain can reuse your clone's files instead of downloading another copy, which makes big pull requests open much faster. Your repository is
        only read, never changed. You'll only be asked once.
      </p>
      {candidates === null ? (
        <p className="text-fog">Looking for it in your usual code folders…</p>
      ) : (
        candidates.length > 0 && (
          <div className="mb-2.5 flex flex-col gap-1.5">
            {candidates.map((c) => (
              <button
                key={c}
                onClick={() => setPath(c)}
                aria-pressed={path === c}
                className="truncate rounded-lg border border-seam px-3 py-2 text-left font-mono text-xs text-fog aria-pressed:border-fog aria-pressed:bg-slate-2 aria-pressed:text-chalk"
              >
                {c}
              </button>
            ))}
          </div>
        )
      )}
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && path.trim() && save(path)}
        placeholder={`Path to your clone, e.g. ~/code/${fullRepo.split('/')[1]}`}
        className="w-full rounded-lg border border-seam bg-graphite px-3 py-2 font-mono text-xs text-chalk outline-none focus:border-fog"
      />
      {error && <p className="mt-2 text-coral">{error}</p>}
      <div className="mt-3.5 flex justify-end gap-2">
        <Button onClick={() => save(null)} disabled={saving}>
          No, download a copy
        </Button>
        <Button variant="primary" onClick={() => save(path)} disabled={saving || !path.trim()}>
          Use this folder
        </Button>
      </div>
    </div>
  )
}
