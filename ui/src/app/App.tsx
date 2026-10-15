import { useCallback, useEffect, useState } from 'react'
import { PrPicker } from '@/features/pr-picker'
import { ReviewPage } from '@/features/review'
import { SettingsDialog } from '@/features/settings'
import { post } from '@/lib/http'
import { ConnectionBanner } from './ConnectionBanner'
import { HomePage } from './HomePage'
import { Providers } from './Providers'

function readRoute(): string | null {
  return new URLSearchParams(location.search).get('pr')
}

/** Routes between the home picker and a review (`?pr=owner/repo/123`) and hosts app-wide dialogs. */
export function App() {
  const [pr, setPr] = useState<string | null>(readRoute)
  const [picker, setPicker] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  // An open tab keeps Grain running; it stops by itself 30 minutes after the last tab is gone.
  useEffect(() => {
    const beat = () => post('/api/heartbeat', {}).catch(() => {})
    beat()
    const t = setInterval(beat, 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const onPop = () => setPr(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openPr = useCallback((id: string) => {
    setPicker(false)
    history.pushState(null, '', `?pr=${id}`)
    setPr(id)
  }, [])

  return (
    <Providers>
      {pr ? (
        <ReviewPage key={pr} id={pr} settingsVersion={settingsVersion} onSwitch={() => setPicker(true)} onSettings={() => setSettings(true)} />
      ) : (
        <HomePage onOpen={openPr} onSettings={() => setSettings(true)} settingsVersion={settingsVersion} />
      )}
      {picker && <PrPicker variant="dialog" onOpen={openPr} onClose={() => setPicker(false)} />}
      <ConnectionBanner />
      {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={() => setSettingsVersion((v) => v + 1)} />}
    </Providers>
  )
}
