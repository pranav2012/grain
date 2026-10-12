/** Accepts a GitHub PR link, owner/repo#123 or owner/repo/123 and returns owner/repo/123. */
export function parsePrRef(input: string): string | null {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/^github\.com\//, '')
  const m = /^([\w.-]+)\/([\w.-]+)(?:\/pulls?\/|#|\/)(\d+)/.exec(s)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null
}

export function formatPrRef(id: string): string {
  return id.replace(/\/(\d+)$/, ' #$1')
}
