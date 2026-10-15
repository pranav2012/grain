import { useSyncExternalStore } from 'react'

let online = true
const listeners = new Set<() => void>()

/** Records whether the last request reached the Grain server; the connection banner follows it. */
export function setOnline(value: boolean) {
  if (online === value) return
  online = value
  for (const l of listeners) l()
}

export function useOnline() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => online,
  )
}
