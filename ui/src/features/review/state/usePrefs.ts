import { useEffect, useState } from 'react'
import type { DiffStyle } from '../model/types'

export interface Prefs {
  diffStyle: DiffStyle
}

const defaults: Prefs = { diffStyle: 'unified' }

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
