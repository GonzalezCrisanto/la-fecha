import { useEffect, useRef, useState } from 'react'
import Draft from './Draft'
import SimResult from './SimResult'
import { callSimEngine, callSimEngineSecondHalf, simulateMatch } from '../lib/simulation'
import { StrategyPicker } from './Adventure'
import { STRATEGIES } from '../lib/adventure'
import type { Player, Formation, RivalTeam } from '../types'
import type { MatchResult, MatchEvent } from '../lib/simulation'
import type { GameStrategy } from '../lib/adventure'

type MpScreen = 'lobby' | 'waiting-opponent' | 'drafting' | 'strategy' | 'waiting-squad' | 'loading' | 'result'

interface WsStart {
  type: 'start'
  seed: number
  home: { squad: Player[]; formation: Formation; strategy: GameStrategy }
  away: { squad: Player[]; formation: Formation; strategy: GameStrategy }
}

interface Props {
  onBack: () => void
}

export default function Multiplayer({ onBack }: Props) {
  const [screen, setScreen] = useState<MpScreen>('lobby')
  const [roomCode, setRoomCode] = useState('')
  const [joinInput, setJoinInput] = useState('')
  const [error, setError] = useState('')
  const [strategy, setStrategy] = useState<GameStrategy>('balanced')
  const [simResult, setSimResult] = useState<MatchResult | null>(null)
  const [rival, setRival] = useState<RivalTeam | null>(null)
  const [seed, setSeed] = useState(0)
  const [mySquad, setMySquad] = useState<Player[]>([])
  const [myFormation, setMyFormation] = useState<Formation>('4-3-3')

  // refs to avoid stale closures in ws.onmessage
  const wsRef = useRef<WebSocket | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roleRef = useRef<'home' | 'away'>('home')
  const squadRef = useRef<Player[]>([])
  const formationRef = useRef<Formation>('4-3-3')
  const strategyRef = useRef<GameStrategy>('balanced')

  // canonical match refs (set on 'start', used for second half)
  const homeSquadRef = useRef<Player[]>([])
  const awaySquadRef = useRef<Player[]>([])
  const homeFormationRef = useRef<Formation>('4-3-3')
  const seedRef = useRef(0)

  // halftime coordination
  const halftimeResolveRef = useRef<((events: MatchEvent[]) => void) | null>(null)
  const halftimeRejectRef = useRef<(() => void) | null>(null)
  const halftimeDataRef = useRef<{
    scoreHome: number; scoreAway: number
    bookedHome: string[]; bookedAway: string[]
  } | null>(null)

  const wsUrl = (import.meta.env.VITE_WS_SERVER_URL as string | undefined)

  function flipEvents(events: MatchEvent[]): MatchEvent[] {
    const T = '\x00'
    return events.map(e => ({
      ...e,
      side: e.side === 'home' ? 'away' as const : 'home' as const,
      text: e.text
        ?.replace(/Tu Equipo/g, T)
        .replace(/Rival/g, 'Tu Equipo')
        .replace(/\x00/g, 'Rival'),
    }))
  }

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      if (pingRef.current) clearInterval(pingRef.current)
    }
  }, [])

  function openWs(onOpen: (ws: WebSocket) => void) {
    if (!wsUrl) { setError('VITE_WS_SERVER_URL no configurada'); return }
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      }, 25_000)
      onOpen(ws)
    }

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as { type: string; code?: string; role?: 'home' | 'away'; message?: string; homeStrategy?: string; awayStrategy?: string }

      if (msg.type === 'created') {
        roleRef.current = 'home'
        setRoomCode(msg.code!)
        setScreen('waiting-opponent')
      }
      else if (msg.type === 'joined') {
        roleRef.current = 'away'
        setRoomCode(msg.code!)
        setScreen('drafting')
      }
      else if (msg.type === 'opponent_joined') {
        setScreen('drafting')
      }
      else if (msg.type === 'start') {
        const { seed: s, home, away } = msg as WsStart
        const role = roleRef.current

        // Store canonical refs for second half coordination
        homeSquadRef.current = home.squad
        awaySquadRef.current = away.squad
        homeFormationRef.current = home.formation
        seedRef.current = s

        // Canonical simulation: always home=creator, away=joiner.
        // Both clients run identical inputs → identical result.
        const canonicalRival: RivalTeam = { name: 'Rival', players: away.squad, formation: away.formation }
        setSeed(s)
        setScreen('loading')

        callSimEngine(home.squad, canonicalRival, s, home.strategy, home.formation)
          .catch(() => simulateMatch(home.squad, canonicalRival, s))
          .then(result => {
            if (role === 'away') {
              // Away player flips perspective: their squad becomes home, opponent becomes rival
              const flipped: MatchResult = {
                myGoals:      result.rivalGoals,
                rivalGoals:   result.myGoals,
                myOverall:    result.rivalOverall,
                rivalOverall: result.myOverall,
                events: flipEvents(result.events),
              }
              setMySquad(away.squad)
              setMyFormation(away.formation)
              setStrategy(away.strategy)
              setRival({ name: 'Rival', players: home.squad, formation: home.formation })
              setSimResult(flipped)
            } else {
              setMySquad(home.squad)
              setMyFormation(home.formation)
              setStrategy(home.strategy)
              setRival(canonicalRival)
              setSimResult(result)
            }
            setScreen('result')
          })
      }
      else if (msg.type === 'second_half_go') {
        const { homeStrategy, awayStrategy } = msg as { type: string; homeStrategy: string; awayStrategy: string }
        const role = roleRef.current
        const data = halftimeDataRef.current
        if (!data) return
        const canonicalRival: RivalTeam = { name: 'Rival', players: awaySquadRef.current, formation: homeFormationRef.current }
        callSimEngineSecondHalf(
          homeSquadRef.current, canonicalRival, seedRef.current,
          homeStrategy, data.scoreHome, data.scoreAway,
          data.bookedHome, data.bookedAway,
          homeFormationRef.current, awayStrategy,
        ).then(events => {
          const finalEvents = role === 'away' ? flipEvents(events) : events
          halftimeResolveRef.current?.(finalEvents)
        }).catch(() => halftimeRejectRef.current?.())
      }

      else if (msg.type === 'opponent_left') {
        setError('El rival se desconectó de la sala')
        setScreen('lobby')
      }
      else if (msg.type === 'error') {
        setError(msg.message ?? 'Error desconocido')
      }
    }

    ws.onclose = () => {
      if (pingRef.current) clearInterval(pingRef.current)
    }
  }

  function handleCreate() {
    setError('')
    openWs(ws => ws.send(JSON.stringify({ type: 'create' })))
  }

  function handleJoin() {
    const code = joinInput.trim().toUpperCase()
    if (code.length < 4) { setError('El código debe tener 4 caracteres'); return }
    setError('')
    openWs(ws => ws.send(JSON.stringify({ type: 'join', code })))
  }

  function handleDraftConfirm(squad: Player[], formation: Formation) {
    squadRef.current = squad
    formationRef.current = formation
    setMySquad(squad)
    setMyFormation(formation)
    setScreen('strategy')
  }

  function handleStrategyConfirm() {
    strategyRef.current = strategy
    setScreen('waiting-squad')
    wsRef.current?.send(JSON.stringify({
      type: 'squad',
      squad: squadRef.current,
      formation: formationRef.current,
      strategy: strategyRef.current,
    }))
  }

  const cfg = STRATEGIES[strategy]

  function handleHalftimeConfirm(
    chosenStrategy: GameStrategy,
    htScore: { home: number; away: number },
    bookedHome: string[],
    bookedAway: string[],
  ): Promise<MatchEvent[]> {
    const role = roleRef.current
    // Convert from my perspective (home=me) to canonical (home=creator)
    halftimeDataRef.current = role === 'home'
      ? { scoreHome: htScore.home, scoreAway: htScore.away, bookedHome, bookedAway }
      : { scoreHome: htScore.away, scoreAway: htScore.home, bookedHome: bookedAway, bookedAway: bookedHome }

    wsRef.current?.send(JSON.stringify({ type: 'halftime_strategy', strategy: chosenStrategy }))

    return new Promise((resolve, reject) => {
      halftimeResolveRef.current = resolve
      halftimeRejectRef.current = reject
    })
  }

  // ── Draft ──────────────────────────────────────────────────────────────────
  if (screen === 'drafting') {
    return (
      <Draft
        mode="multiplayer"
        onBack={() => { wsRef.current?.close(); setScreen('lobby') }}
        onConfirm={handleDraftConfirm}
      />
    )
  }

  // ── Strategy picker ────────────────────────────────────────────────────────
  if (screen === 'strategy') {
    return (
      <div className="h-svh flex flex-col" style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b" style={{ background: '#1d2025', borderColor: '#3b4a3d' }}>
          <button onClick={() => setScreen('drafting')} className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea] transition-colors">
            ← Volver
          </button>
          <p className="flex-1 text-center text-body-sm font-semibold text-[#e1e2ea]">Elegí tu estrategia</p>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <p className="text-body-sm text-[#859585] text-center">
            Afecta el xG, la solidez defensiva y las probabilidades de gol.
          </p>
          <div className="w-full max-w-sm">
            <StrategyPicker current={strategy} onSelect={setStrategy} />
          </div>
          {cfg && (
            <div className="rounded-xl px-4 py-3 w-full max-w-sm" style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}>
              <p className="text-body-sm font-semibold text-[#e1e2ea]">{cfg.label}</p>
              <p className="text-label-caps text-[#859585] mt-1">{cfg.pros[0]}</p>
            </div>
          )}
          <button
            onClick={handleStrategyConfirm}
            className="w-full max-w-sm font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            🤝 Enviar equipo
          </button>
        </div>
      </div>
    )
  }

  // ── Loading sim ────────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div className="h-svh flex flex-col items-center justify-center gap-6" style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
        <div style={{ animation: 'ball-bounce 0.7s ease-in-out infinite alternate', fontSize: '56px' }}>⚽</div>
        <p className="text-headline-lg text-[#e1e2ea]">¡El partido está por comenzar!</p>
        <p className="text-body-sm text-[#859585]">Simulando...</p>
      </div>
    )
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  if (screen === 'result' && simResult && rival) {
    return (
      <SimResult
        result={simResult}
        rival={rival}
        squad={mySquad}
        seed={seed}
        initialStrategy={strategy}
        formation={myFormation}
        remainingAttempts={0}
        onHalftimeConfirm={handleHalftimeConfirm}
        onBack={() => { wsRef.current?.close(); onBack() }}
        onReplay={() => {
          wsRef.current?.close()
          setSimResult(null)
          setRival(null)
          setScreen('lobby')
        }}
      />
    )
  }

  // ── Lobby / Waiting ────────────────────────────────────────────────────────
  return (
    <div className="h-svh flex flex-col" style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button
          onClick={() => { wsRef.current?.close(); onBack() }}
          className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea] transition-colors"
        >
          ← Volver
        </button>
        <p className="flex-1 text-center text-body-sm font-semibold text-[#e1e2ea]">🤝 Multijugador</p>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-6">

        {/* ── Lobby ── */}
        {screen === 'lobby' && (
          <>
            <div className="text-center">
              <p className="text-headline-lg text-[#e1e2ea]">¿Cómo querés jugar?</p>
              <p className="text-body-sm text-[#859585] mt-1">Compartí el código con tu rival para jugar en tiempo real</p>
            </div>

            {error && (
              <p className="text-body-sm text-[#ffb4ab] text-center">{error}</p>
            )}

            <div className="w-full max-w-sm flex flex-col gap-3">
              <button
                onClick={handleCreate}
                className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
                style={{ background: '#75ff9e', color: '#003918' }}
              >
                Crear sala
              </button>

              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  placeholder="Código de sala (ej: XKQR)"
                  value={joinInput}
                  onChange={e => setJoinInput(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="w-full rounded-xl px-4 py-3 text-body-sm text-[#e1e2ea] outline-none text-center font-bold tracking-widest uppercase"
                  style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}
                  onFocus={e => (e.target.style.borderColor = '#75ff9e')}
                  onBlur={e => (e.target.style.borderColor = '#3b4a3d')}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                />
                <button
                  onClick={handleJoin}
                  disabled={joinInput.trim().length < 4}
                  className="w-full font-bold py-4 rounded-xl text-body-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: '#1d2025', border: '1px solid #75ff9e', color: '#75ff9e' }}
                >
                  Unirse a sala
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Waiting for opponent to join ── */}
        {screen === 'waiting-opponent' && (
          <div className="text-center flex flex-col items-center gap-6">
            <p className="text-body-sm text-[#859585]">Compartí este código con tu rival</p>
            <div
              className="px-10 py-6 rounded-2xl"
              style={{ background: '#1d2025', border: '2px solid #75ff9e' }}
            >
              <p className="text-display-lg font-bold tracking-[0.2em] text-[#75ff9e]">{roomCode}</p>
            </div>
            <div className="flex items-center gap-2 text-[#859585]">
              <span className="animate-pulse">⏳</span>
              <p className="text-body-sm">Esperando al rival...</p>
            </div>
          </div>
        )}

        {/* ── Waiting for opponent's squad ── */}
        {screen === 'waiting-squad' && (
          <div className="text-center flex flex-col items-center gap-4">
            <div className="text-4xl animate-pulse">⚽</div>
            <p className="text-headline-lg text-[#e1e2ea]">Equipo listo</p>
            <p className="text-body-sm text-[#859585]">Esperando que tu rival confirme su equipo...</p>
          </div>
        )}

      </main>
    </div>
  )
}
