import { useEffect, useState } from 'react'
import { InlineCode } from '@/components/ui/InlineCode'
import { serverFetch } from '@/lib/http'
import { useOnline } from '@/lib/connection'

/**
 * Shown while the Grain server can't be reached. It keeps checking: where the system starts Grain on
 * demand, the check itself starts it, so the banner usually goes away within a second.
 */
export function ConnectionBanner() {
  return useOnline() ? null : <Reconnecting />
}

function Reconnecting() {
  const [tries, setTries] = useState(0)
  useEffect(() => {
    const t = setInterval(() => {
      setTries((n) => n + 1)
      serverFetch('/api/version').catch(() => {})
    }, 2000)
    return () => clearInterval(t)
  }, [])
  return (
    <div role="status" className="fixed top-3 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-warning/50 bg-surface px-4 py-2 text-sm text-fg shadow-overlay">
      {tries >= 4 ? <InlineCode text="Grain isn't running. Start it with `grain` in a terminal; this page reconnects by itself." /> : 'Reconnecting to Grain…'}
    </div>
  )
}
