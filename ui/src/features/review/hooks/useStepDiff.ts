import { useEffect, useState } from 'react'
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import type { Block } from '@/types/generated/Block'
import type { Slice } from '@/types/generated/Slice'
import { reviewApi } from '../api'
import { keepSliceLines, sliceKey } from '../model/slice'

type FileIndex = Map<string, FileDiffMetadata | null>

const cache = new Map<string, FileIndex>()
const inflight = new Map<string, Promise<void>>()

/** Cached per head commit too, so a refreshed review never shows an older diff. */
function indexFor(prId: string, head: string, since?: string, slice?: Slice | null): FileIndex {
  const key = `${prId}@${head}~${since ?? ''}#${sliceKey(slice)}`
  let idx = cache.get(key)
  if (!idx) cache.set(key, (idx = new Map()))
  return idx
}

/** Fetches and parses the diff sections for `files` that aren't cached yet. */
function load(prId: string, head: string, files: string[], since?: string, slice?: Slice | null): Promise<void> {
  const idx = indexFor(prId, head, since, slice)
  const missing = files.filter((f) => !idx.has(f))
  if (!missing.length) return Promise.resolve()
  const key = `${prId}|${head}|${since ?? ''}|${sliceKey(slice)}|${missing.join('\0')}`
  let p = inflight.get(key)
  if (!p) {
    p = reviewApi
      .diff(prId, missing, since)
      .then((full) => {
        const text = slice ? keepSliceLines(full, slice, !!since) : full
        for (const patch of parsePatchFiles(text, `${prId}:${head}:${since ?? ''}:${sliceKey(slice)}:${missing[0]}`)) {
          for (const f of patch.files) {
            idx.set(f.name, f)
            if (f.prevName) idx.set(f.prevName, f)
          }
        }
        // Files untouched since `since` have no section; remember them as empty.
        for (const f of missing) if (!idx.has(f)) idx.set(f, null)
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

/** Parsed diffs for every block of a step, in block order; null until all are loaded. */
export function useStepDiff(prId: string, head: string, blocks: Block[], since?: string, nextFiles?: string[]) {
  const [, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all(blocks.map((b) => load(prId, head, b.files, since, b.slice))).then(
      () => alive && setVersion((v) => v + 1),
      (e: Error) => alive && setError(e.message),
    )
    if (nextFiles) load(prId, head, nextFiles).catch(() => {})
    return () => {
      alive = false
    }
  }, [prId, head, blocks, since, nextFiles])
  const parts = blocks.map((b) => {
    const idx = indexFor(prId, head, since, b.slice)
    if (!b.files.every((f) => idx.has(f))) return null
    const diffs = b.files.map((f) => idx.get(f)).filter((f): f is FileDiffMetadata => !!f)
    return { block: b, diffs: [...new Set(diffs)] }
  })
  const ready = parts.every((p) => p !== null)
  return { parts: ready ? (parts as { block: Block; diffs: FileDiffMetadata[] }[]) : null, error }
}
