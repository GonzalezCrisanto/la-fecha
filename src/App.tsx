import { useState } from 'react'
import Home from './pages/Home'
import Draft from './pages/Draft'
import SimResult from './pages/SimResult'
import Adventure from './pages/Adventure'
import { simulateMatch } from './lib/simulation'
import { getDailyChallenge, getAdventureRivals, teamDisplayName } from './lib/players'
import type { GameMode, Player, DailyChallenge, RivalTeam } from './types'
import type { MatchResult } from './lib/simulation'

type Screen = 'home' | 'draft' | 'sim-loading' | 'sim-result' | 'adventure'

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
      setScreen('sim-loading')
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

  if (screen === 'sim-loading' && challenge) {
    return (
      <SimLoading
        rival={challenge.rival}
        onDone={() => setScreen('sim-result')}
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

function SimLoading({ rival, onDone }: { rival: RivalTeam; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 2200)
    return () => clearTimeout(id)
  }, [onDone])

  return (
    <div
      className="h-svh flex flex-col items-center justify-center gap-6"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <div style={{ animation: 'ball-bounce 0.7s ease-in-out infinite alternate', fontSize: '56px' }}>
        ⚽
      </div>
      <div className="text-center">
        <p className="text-label-caps text-[#75ff9e] tracking-widest mb-2">SIMULANDO PARTIDO</p>
        <p className="text-body-lg text-[#e1e2ea]">vs {teamDisplayName(rival.name)}</p>
      </div>
      <div className="flex gap-1.5 mt-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-[#75ff9e]"
            style={{ animation: `dot-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
      <style>{`
        @keyframes ball-bounce {
          from { transform: translateY(0px); }
          to   { transform: translateY(-18px); }
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}
