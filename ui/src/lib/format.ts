export function ago(iso?: string): string {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(m, 1)} min ago`
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

/** Rough reading time at ~40 changed lines per minute. */
export function minutesFor(lines: number): number {
  return Math.max(1, Math.round(lines / 40))
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export function plural(n: number, noun: string): string {
  const k = noun.replace(/_/g, ' ')
  if (n === 1) return `1 ${k}`
  const many = /(s|x|ch|sh)$/.test(k) ? `${k}es` : k.endsWith('y') ? `${k.slice(0, -1)}ies` : `${k}s`
  return `${n} ${many}`
}

export function joinList(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

export function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}

/** A dollar amount the way spend is shown: cents below $10, whole dollars above; "<$0.01" for tiny amounts. */
export function usd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01'
  return n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`
}
