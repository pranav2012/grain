/** Accepts a GitHub PR link, owner/repo#123 or owner/repo/123 and returns owner/repo/123. */
export function parsePrRef(input: string): string | null {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/^github\.com\//, '')
  const m = /^([\w.-]+)\/([\w.-]+)(?:\/pulls?\/|#|\/)(\d+)/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null
}

/** Review ids of local changes start with this owner (see `LOCAL_OWNER` on the server). */
export const isLocalId = (id: string) => id.startsWith('~local/')

/** Looks like a folder on disk rather than a pull request. */
export const looksLikePath = (input: string) => /^(\/|~\/|~$|\.{1,2}(\/|$))/.test(input.trim())

export function formatPrRef(id: string): string {
  return isLocalId(id) ? 'Local changes' : id.replace(/\/(\d+)$/, ' #$1')
}
