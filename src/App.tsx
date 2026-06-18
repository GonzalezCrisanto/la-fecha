import { useState } from 'react'
import Home from './pages/Home'
import Draft from './pages/Draft'
import SimResult from './pages/SimResult'
import Adventure from './pages/Adventure'
import { simulateMatch } from './lib/simulation'
import { getDailyChallenge, getAdventureRivals } from './lib/players'
import type { GameMode, Player, DailyChallenge, RivalTeam } from './types'
import type { MatchResult } from './lib/simulation'

type Screen = 'home' | 'draft' | 'sim-result' | 'adventure'

function dateSeed(): number {
  return new Date().toISOString().slice(0, 10).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [mode, setMode] = useState<GameMode>('sim')
  const [squad, setSquad] = useState<Player[]>([])
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null)
  const [simResult, setSimResult] = useState<MatchResult | null>(null)
  const [adventureRivals, setAdventureRivals] = useState<RivalTeam[]>([])

  function handlePlay(selectedMode: GameMode) {
    setMode(selectedMode)
    setScreen('draft')
  }

  function handleConfirm(confirmedSquad: Player[], ch: DailyChallenge, allPlayers: Player[]) {
    setSquad(confirmedSquad)
    setChallenge(ch)

    if (mode === 'sim') {
      const result = simulateMatch(confirmedSquad, ch.rival, dateSeed())
      setSimResult(result)
      setScreen('sim-result')
    } else {
      const rivals = getAdventureRivals(allPlayers)
      setAdventureRivals(rivals)
      setScreen('adventure')
    }
  }

  function goHome() {
    setScreen('home')
    setSquad([])
    setSimResult(null)
  }

  function replay() {
    setScreen('draft')
    setSquad([])
    setSimResult(null)
  }

  if (screen === 'draft') {
    return (
      <DraftBridge
        mode={mode}
        onBack={goHome}
        onConfirm={handleConfirm}
      />
    )
  }

  if (screen === 'sim-result' && simResult && challenge) {
    return (
      <SimResult
        result={simResult}
        rival={challenge.rival}
        onBack={goHome}
        onReplay={replay}
      />
    )
  }

  if (screen === 'adventure' && adventureRivals.length > 0) {
    return (
      <Adventure
        squad={squad}
        rivals={adventureRivals}
        dateSeed={dateSeed()}
        onBack={goHome}
        onReplay={replay}
      />
    )
  }

  return <Home onPlay={handlePlay} />
}

// Bridge component that loads players and passes them up on confirm
import { useEffect, useRef } from 'react'
import { loadPlayers } from './lib/players'

function DraftBridge({
  mode,
  onBack,
  onConfirm,
}: {
  mode: GameMode
  onBack: () => void
  onConfirm: (squad: Player[], challenge: DailyChallenge, allPlayers: Player[]) => void
}) {
  const allPlayersRef = useRef<Player[]>([])
  const challengeRef = useRef<DailyChallenge | null>(null)

  useEffect(() => {
    loadPlayers().then(players => {
      allPlayersRef.current = players
      challengeRef.current = getDailyChallenge(players)
    })
  }, [])

  function handleConfirm(squad: Player[]) {
    if (challengeRef.current) {
      onConfirm(squad, challengeRef.current, allPlayersRef.current)
    }
  }

  return <Draft mode={mode} onBack={onBack} onConfirm={handleConfirm} />
}
