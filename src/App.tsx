import { useState } from 'react'
import Home from './pages/Home'
import Draft from './pages/Draft'
import SimResult from './pages/SimResult'
import Adventure from './pages/Adventure'
import Multiplayer from './pages/Multiplayer'
import PenaltyShootout from './pages/PenaltyShootout'
import { StrategyPicker } from './pages/Adventure'
import { simulateMatch, callSimEngine } from './lib/simulation'
import { getDailyChallenge, getAdventureRivals, teamDisplayName } from './lib/players'
import { getRemainingAttempts, consumeAttempt, resetAttempts } from './lib/attempts'
import { STRATEGIES } from './lib/adventure'
import type { GameMode, Player, DailyChallenge, RivalTeam, Formation } from './types'
import type { MatchResult } from './lib/simulation'
import type { GameStrategy } from './lib/adventure'

type Screen = 'home' | 'draft' | 'sim-strategy' | 'sim-loading' | 'sim-result' | 'adventure' | 'penalty' | 'multiplayer'

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
  const [simAttempts, setSimAttempts] = useState(() => getRemainingAttempts('sim'))
  const [adventureAttempts, setAdventureAttempts] = useState(() => getRemainingAttempts('adventure'))
  const [simStrategy, setSimStrategy] = useState<GameStrategy>('balanced')
  const [simFormation, setSimFormation] = useState<Formation>('4-3-3')

  function handlePlay(selectedMode: GameMode) {
    setMode(selectedMode)
    if (selectedMode === 'multiplayer') {
      setScreen('multiplayer')
    } else {
      setScreen('draft')
    }
  }

  function handleConfirm(confirmedSquad: Player[], formation: Formation, ch: DailyChallenge, allPlayers: Player[]) {
    setSquad(confirmedSquad)
    setChallenge(ch)
    setSimFormation(formation)

    if (mode === 'sim') {
      consumeAttempt('sim')
      setSimAttempts(getRemainingAttempts('sim'))
      setScreen('sim-strategy')
    } else {
      consumeAttempt('adventure')
      setAdventureAttempts(getRemainingAttempts('adventure'))
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

  if (screen === 'sim-strategy' && challenge) {
    return (
      <SimStrategyScreen
        rival={challenge.rival}
        strategy={simStrategy}
        onSelect={setSimStrategy}
        onConfirm={() => setScreen('sim-loading')}
        onBack={() => setScreen('draft')}
      />
    )
  }

  if (screen === 'sim-loading' && challenge) {
    return (
      <SimLoading
        squad={squad}
        rival={challenge.rival}
        seed={dateSeed()}
        strategy={simStrategy}
        formation={simFormation}
        onDone={(result) => {
          setSimResult(result)
          setScreen('sim-result')
        }}
      />
    )
  }

  if (screen === 'sim-result' && simResult && challenge) {
    return (
      <SimResult
        result={simResult}
        rival={challenge.rival}
        squad={squad}
        seed={dateSeed()}
        initialStrategy={simStrategy}
        formation={simFormation}
        remainingAttempts={simAttempts}
        onBack={goHome}
        onReplay={replay}
        onPenalties={() => setScreen('penalty')}
      />
    )
  }

  if (screen === 'penalty' && challenge) {
    return (
      <PenaltyShootout
        squad={squad}
        rival={challenge.rival}
        seed={dateSeed()}
        onBack={goHome}
      />
    )
  }

  if (screen === 'multiplayer') {
    return <Multiplayer onBack={goHome} />
  }

  if (screen === 'adventure' && adventureRivals.length > 0) {
    return (
      <Adventure
        squad={squad}
        rivals={adventureRivals}
        dateSeed={dateSeed()}
        remainingAttempts={adventureAttempts}
        onBack={goHome}
        onReplay={replay}
      />
    )
  }

  function handleResetAttempts() {
    resetAttempts()
    setSimAttempts(getRemainingAttempts('sim'))
    setAdventureAttempts(getRemainingAttempts('adventure'))
  }

  return (
    <Home
      onPlay={handlePlay}
      simAttempts={simAttempts}
      adventureAttempts={adventureAttempts}
      onResetAttempts={handleResetAttempts}
    />
  )
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
  onConfirm: (squad: Player[], formation: Formation, challenge: DailyChallenge, allPlayers: Player[]) => void
}) {
  const allPlayersRef = useRef<Player[]>([])
  const challengeRef = useRef<DailyChallenge | null>(null)

  useEffect(() => {
    loadPlayers().then(players => {
      allPlayersRef.current = players
      challengeRef.current = getDailyChallenge(players)
    })
  }, [])

  function handleConfirm(squad: Player[], formation: Formation) {
    if (challengeRef.current) {
      onConfirm(squad, formation, challengeRef.current, allPlayersRef.current)
    }
  }

  return <Draft mode={mode} onBack={onBack} onConfirm={handleConfirm} />
}

function SimLoading({ squad, rival, seed, strategy, formation, onDone }: {
  squad: Player[]
  rival: RivalTeam
  seed: number
  strategy: GameStrategy
  formation: Formation
  onDone: (result: MatchResult) => void
}) {
  useEffect(() => {
    callSimEngine(squad, rival, seed, strategy, formation)
      .then(result => onDone(result))
      .catch(err => {
        console.warn('[SimEngine] Fallback a simulación local:', err)
        onDone(simulateMatch(squad, rival, seed))
      })
  }, [])

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

function SimStrategyScreen({ rival, strategy, onSelect, onConfirm, onBack }: {
  rival: RivalTeam
  strategy: GameStrategy
  onSelect: (s: GameStrategy) => void
  onConfirm: () => void
  onBack: () => void
}) {
  const cfg = STRATEGIES[strategy]
  return (
    <div
      className="h-svh flex flex-col"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button onClick={onBack} className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea] transition-colors">
          ← Volver
        </button>
        <p className="flex-1 text-center text-body-sm font-semibold text-[#e1e2ea]">
          Estrategia · vs {teamDisplayName(rival.name)}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-5">
        <div>
          <p className="text-label-caps text-[#859585] mb-1 tracking-widest">ELEGÍ TU TÁCTICA</p>
          <p className="text-body-sm text-[#bacbb9]">
            Influye en el xG, la solidez defensiva y las probabilidades de gol durante la simulación.
          </p>
        </div>
        <StrategyPicker current={strategy} onSelect={onSelect} />
        {cfg && (
          <div
            className="rounded-xl p-4 flex flex-col gap-1"
            style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}
          >
            <p className="text-body-sm font-bold text-[#e1e2ea] mb-1">{cfg.label}</p>
            {cfg.pros.map(p => <p key={p} className="text-label-caps" style={{ color: '#75ff9e', fontSize: '11px' }}>{p}</p>)}
            {cfg.cons.map(c => <p key={c} className="text-label-caps" style={{ color: '#ffb4ab', fontSize: '11px' }}>{c}</p>)}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-4 border-t" style={{ background: '#1d2025', borderColor: '#3b4a3d' }}>
        <button
          onClick={onConfirm}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          Simular partido →
        </button>
      </div>
    </div>
  )
}
