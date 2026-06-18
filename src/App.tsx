import { useState } from 'react'
import Home from './pages/Home'
import Draft from './pages/Draft'
import type { GameMode } from './types'

type Screen = 'home' | 'draft'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [mode, setMode] = useState<GameMode>('sim')

  function handlePlay(selectedMode: GameMode) {
    setMode(selectedMode)
    setScreen('draft')
  }

  if (screen === 'draft') {
    return <Draft mode={mode} onBack={() => setScreen('home')} />
  }

  return <Home onPlay={handlePlay} />
}
