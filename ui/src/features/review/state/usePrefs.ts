import { useEffect, useState } from 'react'
import type { DiffStyle } from '../model/types'

export interface Prefs {
  diffStyle: DiffStyle
  /** Show blocks in files you own (CODEOWNERS) first. */
  mineFirst: boolean
}

const defaults: Prefs = { diffStyle: 'split', mineFirst: false }

/** View preferences shared across PRs. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem('grain:prefs') ?? '{}') }
    } catch {
      return defaults
    }
  })
  useEffect(() => {
    localStorage.setItem('grain:prefs', JSON.stringify(prefs))
  }, [prefs])
  return [prefs, setPrefs] as const
}
