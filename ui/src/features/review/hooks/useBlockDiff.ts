import { useEffect, useState } from 'react'
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { reviewApi } from '../api'

type FileIndex = Map<string, FileDiffMetadata>

const cache = new Map<string, FileIndex>()
const inflight = new Map<string, Promise<void>>()

function indexFor(prId: string): FileIndex {
  let idx = cache.get(prId)
  if (!idx) cache.set(prId, (idx = new Map()))
  return idx
}

/** Fetches and parses the diff sections for `files` that aren't cached yet. */
function load(prId: string, files: string[]): Promise<void> {
  const idx = indexFor(prId)
  const missing = files.filter((f) => !idx.has(f))
  if (!missing.length) return Promise.resolve()
  const key = `${prId}|${missing.join('\0')}`
  let p = inflight.get(key)
  if (!p) {
    p = reviewApi
      .diff(prId, missing)
      .then((text) => {
        for (const patch of parsePatchFiles(text, `${prId}:${missing[0]}`)) {
          for (const f of patch.files) {
            idx.set(f.name, f)
            if (f.prevName) idx.set(f.prevName, f)
          }
        }
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/** The current block's parsed file diffs (loaded on demand, cached), and warms the next block. */
export function useBlockDiff(prId: string, files: string[], nextFiles: string[] | undefined) {
  const idx = indexFor(prId)
  const ready = files.every((f) => idx.has(f))
  const [, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load(prId, files).then(
      () => alive && setVersion((v) => v + 1),
      (e: Error) => alive && setError(e.message),
    )
    if (nextFiles) load(prId, nextFiles).catch(() => {})
    return () => {
      alive = false
    }
  }, [prId, files, nextFiles])
  const diffs = ready ? files.map((f) => idx.get(f)).filter((f): f is FileDiffMetadata => !!f) : null
  return { diffs: diffs && [...new Set(diffs)], error }
}
