import { useCallback, useEffect, useState } from 'react'
import { PrPicker } from '@/features/pr-picker'
import { ReviewPage } from '@/features/review'
import { SettingsDialog } from '@/features/settings'
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
        <HomePage onOpen={openPr} onSettings={() => setSettings(true)} />
      )}
      {picker && <PrPicker variant="dialog" onOpen={openPr} onClose={() => setPicker(false)} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} onSaved={() => setSettingsVersion((v) => v + 1)} />}
    </Providers>
  )
}
