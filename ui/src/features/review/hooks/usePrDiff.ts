import { useEffect, useState } from 'react'
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'
import { reviewApi } from '../api'

export interface FilePatch {
  diff: FileDiffMetadata
  /** Changes whenever the file's diff does; a viewed file with another hash needs another look. */
  hash: string
  added: number
  removed: number
}

const cache = new Map<string, Promise<Map<string, FilePatch>>>()

const hashText = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const pathOf = (section: string) => /^diff --git "?a\/.*?"? "?b\/(.*?)"?$/m.exec(section)?.[1]

function load(prId: string, head: string): Promise<Map<string, FilePatch>> {
  const key = `${prId}@${head}`
  let p = cache.get(key)
  if (!p) {
    p = reviewApi.diff(prId, []).then((text) => {
      const hashes = new Map<string, string>()
      for (const section of text.split(/^(?=diff --git )/m)) {
        const path = pathOf(section)
        if (path) hashes.set(path, hashText(section.replace(/^index .*$/m, '')))
      }
      const out = new Map<string, FilePatch>()
      for (const patch of parsePatchFiles(text, key))
        for (const diff of patch.files) {
          const added = diff.hunks.reduce((n, h) => n + h.additionLines, 0)
          const removed = diff.hunks.reduce((n, h) => n + h.deletionLines, 0)
          out.set(diff.name, { diff, hash: hashes.get(diff.name) ?? '', added, removed })
        }
      return out
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/** Every file's parsed diff for the PR at `head`, loaded in one request. */
export function usePrDiff(prId: string, head: string) {
  const [patches, setPatches] = useState<Map<string, FilePatch> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load(prId, head).then(
      (m) => alive && setPatches(m),
      (e: Error) => alive && setError(e.message),
    )
    return () => {
      alive = false
    }
  }, [prId, head])
  return { patches, error }
}
