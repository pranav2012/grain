import { useEffect, useEffectEvent } from 'react'

export type Hotkeys = Record<string, () => void>

/**
 * Global single-key shortcuts (e.g. `j`, `Shift+Enter`, `Mod+k`), ignored while typing.
 * `Mod` is ⌘ on macOS and Ctrl elsewhere. The latest handlers are always used.
 */
export function useHotkeys(keys: Hotkeys) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    const name = `${mod ? 'Mod+' : ''}${e.shiftKey && e.key.length > 1 ? 'Shift+' : ''}${e.key}`
    const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]')
    if ((typing && !mod) || e.altKey) return
    const action = keys[name]
    if (action) {
      e.preventDefault()
      action()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
