import { useState, useEffect, useRef } from 'react'
import type { Player, RivalTeam } from '../types'
import { teamDisplayName } from '../lib/players'
import {
  simulateKick, simulateRivalKick, autoSelectRivalKickers, getGK,
  getKicker, getShootoutStatus,
  type PenaltyZone, type PenaltyOutcome, type KickRecord,
} from '../lib/penalty'

interface Props {
  squad: Player[]
  rival: RivalTeam
  seed: number
  onBack: () => void
}

type Phase = 'coin-toss' | 'order-selection' | 'shooting' | 'done'
type KickStep = 'idle' | 'animating' | 'showing-result'

const ZONE_LABEL: Record<PenaltyZone, string> = {
  TL: 'Arriba Izq', TC: 'Arriba Centro', TR: 'Arriba Der',
  BL: 'Abajo Izq',  BC: 'Abajo Centro',  BR: 'Abajo Der',
}

export default function PenaltyShootout({ squad, rival, seed, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('coin-toss')
  const [goesFirst, setGoesFirst] = useState<'home' | 'away'>('home')
  const [homeOrder, setHomeOrder] = useState<Player[]>([])
  const [awayOrder] = useState(() => autoSelectRivalKickers(rival.players))
  const [kicks, setKicks] = useState<KickRecord[]>([])
  const [kickStep, setKickStep] = useState<KickStep>('idle')
  const [lastKick, setLastKick] = useState<KickRecord | null>(null)
  const [pendingZone, setPendingZone] = useState<PenaltyZone | null>(null)
  const [winner, setWinner] = useState<'home' | 'away' | null>(null)
  const [pendingRivalKick, setPendingRivalKick] = useState<{
    kicker: Player; zone: PenaltyZone; gkZone: PenaltyZone; outcome: PenaltyOutcome
  } | null>(null)

  const kicksRef = useRef<KickRecord[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const innerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const homeGK = getGK(squad)
  const awayGK = getGK(rival.players)

  const homeKicks = kicks.filter(k => k.side === 'home')
  const awayKicks = kicks.filter(k => k.side === 'away')
  const homeGoals = homeKicks.filter(k => k.outcome === 'goal').length
  const awayGoals = awayKicks.filter(k => k.outcome === 'goal').length

  const kickIndex = kicks.length
  const nextSide: 'home' | 'away' =
    kickIndex % 2 === 0 ? goesFirst : (goesFirst === 'home' ? 'away' : 'home')

  const nextKicker = phase === 'shooting'
    ? getKicker(
        nextSide,
        nextSide === 'home' ? homeKicks.length : awayKicks.length,
        nextSide === 'home' ? homeOrder : awayOrder,
        nextSide === 'home' ? squad : rival.players,
        seed,
      )
    : null

  const isRegulation = Math.max(homeKicks.length, awayKicks.length) < 5

  function clearTimer() {
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  function processKick(kick: KickRecord) {
    kicksRef.current = [...kicksRef.current, kick]
    const status = getShootoutStatus(kicksRef.current)
    setKicks([...kicksRef.current])
    setLastKick(kick)
    setPendingZone(null)
    setKickStep('showing-result')
    clearTimer()
    timerRef.current = setTimeout(() => {
      setLastKick(null)
      if (status !== 'ongoing') {
        setWinner(status)
        setPhase('done')
      } else {
        setKickStep('idle')
      }
    }, 1800)
  }

  // Effect 1: wait for rival's turn then compute kick and start animation
  // Cannot nest setKickStep inside the timeout because that re-render would trigger cleanup
  // which cancels the inner timer. Solution: split into two separate effects.
  useEffect(() => {
    if (phase !== 'shooting') return
    if (kickStep !== 'idle') return
    if (nextSide === 'home') return
    if (winner) return

    const idx = kicksRef.current.length
    const sideCount = kicksRef.current.filter(k => k.side === 'away').length
    const kicker = getKicker('away', sideCount, awayOrder, rival.players, seed)

    timerRef.current = setTimeout(() => {
      const { zone, gkZone, outcome } = simulateRivalKick(kicker, homeGK, seed + idx * 37)
      setKickStep('animating')
      setPendingRivalKick({ kicker, zone, gkZone, outcome })
    }, 1200)

    return clearTimer
  }, [phase, kickStep, nextSide, kicks.length, winner])

  // Effect 2: once animation starts and kick is ready, process it after the animation delay
  useEffect(() => {
    if (kickStep !== 'animating' || !pendingRivalKick) return

    innerTimerRef.current = setTimeout(() => {
      const kick = pendingRivalKick
      setPendingRivalKick(null)
      processKick({ side: 'away', ...kick })
    }, 1500)

    return () => {
      if (innerTimerRef.current) clearTimeout(innerTimerRef.current)
    }
  }, [kickStep, pendingRivalKick])

  useEffect(() => () => {
    clearTimer()
    if (innerTimerRef.current) clearTimeout(innerTimerRef.current)
  }, [])

  function handleCoinToss(first: 'home' | 'away') {
    setGoesFirst(first)
    setPhase('order-selection')
  }

  function toggleKicker(player: Player) {
    setHomeOrder(prev => {
      if (prev.some(p => p.id === player.id)) return prev.filter(p => p.id !== player.id)
      if (prev.length >= 5) return prev
      return [...prev, player]
    })
  }

  function handleZoneClick(zone: PenaltyZone) {
    if (kickStep !== 'idle' || nextSide !== 'home' || !nextKicker) return
    const idx = kicksRef.current.length
    const kicker = nextKicker
    setPendingZone(zone)
    setKickStep('animating')
    clearTimer()
    timerRef.current = setTimeout(() => {
      const { outcome, gkZone } = simulateKick(kicker, awayGK, zone, seed + idx * 37)
      processKick({ side: 'home', kicker, zone, gkZone, outcome })
    }, 1500)
  }

  if (phase === 'coin-toss') {
    return <CoinTossScreen seed={seed} onToss={handleCoinToss} onBack={onBack} />
  }

  if (phase === 'order-selection') {
    return (
      <OrderSelectionScreen
        squad={squad}
        order={homeOrder}
        onToggle={toggleKicker}
        onConfirm={() => setPhase('shooting')}
        onBack={onBack}
      />
    )
  }

  if (phase === 'done' && winner) {
    return (
      <DoneScreen
        winner={winner}
        homeGoals={homeGoals}
        awayGoals={awayGoals}
        rivalName={rival.name}
        onBack={onBack}
      />
    )
  }

  // ── Main shooting screen ────────────────────────────────────────────────────

  const shotZone = lastKick?.side === 'home' ? lastKick.zone : pendingZone ?? undefined
  const gkZoneDisplay = lastKick ? lastKick.gkZone : undefined

  return (
    <div
      className="h-svh flex flex-col"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button onClick={onBack} className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea]">
          ← Salir
        </button>
        <p className="flex-1 text-center text-label-caps font-bold text-[#ffde6e]">
          TANDA DE PENALES
        </p>
      </header>

      {/* Score */}
      <div className="shrink-0 px-4 py-4 flex items-center justify-center gap-10 text-center">
        <div>
          <p className="text-label-caps text-[#859585] mb-1">VOS</p>
          <p className="text-[52px] font-black leading-none text-[#75ff9e]">{homeGoals}</p>
        </div>
        <p className="text-[32px] text-[#3b4a3d] font-bold mt-2">—</p>
        <div>
          <p className="text-label-caps text-[#859585] mb-1 truncate max-w-[96px]">
            {teamDisplayName(rival.name).toUpperCase()}
          </p>
          <p className="text-[52px] font-black leading-none text-[#e1e2ea]">{awayGoals}</p>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex items-start gap-2 px-3 overflow-hidden">
        <KickerPanel
          side="home"
          kicks={homeKicks}
          label="VOS"
          currentKicker={nextSide === 'home' && kickStep === 'idle' ? nextKicker : null}
        />

        <div className="flex-1 flex flex-col items-center gap-3 pt-1">
          <GoalSVG
            onZoneClick={handleZoneClick}
            disabled={nextSide !== 'home' || kickStep !== 'idle' || phase !== 'shooting'}
            shotZone={shotZone}
            gkZone={gkZoneDisplay}
            animating={kickStep === 'animating'}
          />
          <StatusMessage
            kickStep={kickStep}
            lastKick={lastKick}
            nextSide={nextSide}
            nextKicker={nextKicker}
            rivalName={rival.name}
          />
        </div>

        <KickerPanel
          side="away"
          kicks={awayKicks}
          label={teamDisplayName(rival.name).toUpperCase().slice(0, 8)}
          currentKicker={nextSide === 'away' && kickStep === 'idle' ? nextKicker : null}
        />
      </div>

      {/* Round label */}
      <div className="shrink-0 px-4 py-3 text-center">
        <p className="text-label-caps text-[#859585]">
          {isRegulation
            ? `Penal ${Math.max(homeKicks.length, awayKicks.length) + 1} de 5`
            : 'MUERTE SÚBITA'}
        </p>
      </div>

      <style>{`
        @keyframes zone-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CoinTossScreen({
  seed,
  onToss,
  onBack,
}: {
  seed: number
  onToss: (first: 'home' | 'away') => void
  onBack: () => void
}) {
  const [state, setState] = useState<'idle' | 'flipping' | 'result'>('idle')
  const [coinResult, setCoinResult] = useState<'home' | 'away' | null>(null)

  function handleFlip() {
    if (state !== 'idle') return
    setState('flipping')
    const first: 'home' | 'away' = Math.abs(Math.sin(seed * 9301)) > 0.5 ? 'home' : 'away'
    setTimeout(() => {
      setCoinResult(first)
      setState('result')
      setTimeout(() => onToss(first), 1500)
    }, 1500)
  }

  return (
    <div
      className="h-svh flex flex-col items-center justify-center gap-8 px-6"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <p className="text-label-caps text-[#859585] tracking-widest">TANDA DE PENALES</p>
      <div className="text-center">
        <p className="text-[28px] font-black text-[#e1e2ea] mb-2">Lanzá la moneda</p>
        <p className="text-body-sm text-[#859585]">Para ver quién patea primero</p>
      </div>
      <div
        className="text-[80px] select-none inline-block"
        style={{ animation: state === 'flipping' ? 'coin-flip 1.5s ease-in-out forwards' : undefined }}
      >
        🪙
      </div>
      {state === 'result' && coinResult && (
        <p
          className="text-body-lg font-bold"
          style={{ color: coinResult === 'home' ? '#75ff9e' : '#ffb4ab' }}
        >
          {coinResult === 'home' ? '¡VOS pateás primero!' : '¡ELLOS patean primero!'}
        </p>
      )}
      {state === 'idle' && (
        <button
          onClick={handleFlip}
          className="font-bold py-4 px-8 rounded-xl text-body-lg transition-all electric-glow"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          Lanzar moneda →
        </button>
      )}
      <button onClick={onBack} className="text-body-sm text-[#859585]">
        ← Volver
      </button>
      <style>{`
        @keyframes coin-flip {
          0%   { transform: perspective(400px) rotateY(0deg); }
          100% { transform: perspective(400px) rotateY(1440deg); }
        }
      `}</style>
    </div>
  )
}

function OrderSelectionScreen({
  squad,
  order,
  onToggle,
  onConfirm,
  onBack,
}: {
  squad: Player[]
  order: Player[]
  onToggle: (p: Player) => void
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <div
      className="h-svh flex flex-col"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button onClick={onBack} className="text-body-sm text-[#bacbb9]">← Volver</button>
        <p className="flex-1 text-center text-label-caps font-bold text-[#e1e2ea]">
          ELEGÍ TUS PATEADORES
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <p className="text-body-sm text-[#859585]">
          Elegí los primeros 5 en orden. Tocá para agregar o quitar.
        </p>

        {/* Order preview slots */}
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map(n => {
            const p = order[n]
            return (
              <div
                key={n}
                className="flex-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-center min-h-[60px]"
                style={{
                  borderColor: p ? '#75ff9e' : '#3b4a3d',
                  background: p ? '#75ff9e0d' : '#1d2025',
                }}
              >
                <span className="text-label-caps text-[#75ff9e] text-[10px]">{n + 1}°</span>
                {p && (
                  <span className="text-[10px] text-[#e1e2ea] font-semibold leading-tight">
                    {p.name.split(' ').slice(-1)[0]}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Player list */}
        <div className="flex flex-col gap-1.5">
          {squad.map(p => {
            const idx = order.findIndex(o => o.id === p.id)
            const isSelected = idx >= 0
            return (
              <button
                key={p.id}
                onClick={() => onToggle(p)}
                className="flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
                style={{
                  background: isSelected ? '#75ff9e0d' : '#1d2025',
                  borderColor: isSelected ? '#75ff9e' : '#3b4a3d',
                }}
              >
                <div
                  className="w-6 h-6 rounded flex items-center justify-center shrink-0 text-label-caps font-bold"
                  style={{
                    background: isSelected ? '#75ff9e' : '#272a30',
                    color: isSelected ? '#003918' : '#859585',
                    fontSize: '11px',
                  }}
                >
                  {isSelected ? idx + 1 : ''}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-semibold text-[#e1e2ea] truncate">{p.name}</p>
                  <p className="text-[10px] text-[#859585]">{p.position} · OVR {p.overall}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 px-4 py-4 border-t" style={{ background: '#1d2025', borderColor: '#3b4a3d' }}>
        <button
          onClick={onConfirm}
          disabled={order.length !== 5}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow disabled:opacity-40"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          {order.length < 5 ? `Elegí ${5 - order.length} más →` : 'Empezar penales →'}
        </button>
      </div>
    </div>
  )
}

function KickerPanel({
  side,
  kicks,
  label,
  currentKicker,
}: {
  side: 'home' | 'away'
  kicks: KickRecord[]
  label: string
  currentKicker: Player | null
}) {
  const color = side === 'home' ? '#75ff9e' : '#ffb4ab'
  const regulationDots = kicks.slice(0, 5)
  const sdDots = kicks.slice(5)

  return (
    <div className="flex flex-col items-center gap-2 w-16 pt-1">
      <p className="text-[9px] text-[#859585] text-center font-semibold tracking-wide truncate w-full">
        {label}
      </p>
      {/* Regulation dots */}
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4].map(i => {
          const k = regulationDots[i]
          const isGoal = k?.outcome === 'goal'
          const isDone = !!k
          return (
            <div
              key={i}
              className="w-6 h-6 rounded border flex items-center justify-center text-xs font-bold"
              style={{
                borderColor: isDone ? (isGoal ? color : '#ffb4ab') : '#3b4a3d',
                background: isDone ? (isGoal ? color + '22' : '#ffb4ab22') : '#1d2025',
                color: isGoal ? color : '#ffb4ab',
              }}
            >
              {isGoal ? '✓' : isDone ? '✗' : ''}
            </div>
          )
        })}
      </div>
      {/* Sudden death dots */}
      {sdDots.map((k, i) => (
        <div
          key={i}
          className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold"
          style={{
            background: k.outcome === 'goal' ? color + '22' : '#ffb4ab22',
            color: k.outcome === 'goal' ? color : '#ffb4ab',
          }}
        >
          {k.outcome === 'goal' ? '✓' : '✗'}
        </div>
      ))}
      {/* Current kicker */}
      {currentKicker && (
        <p className="text-[9px] text-center leading-tight font-semibold mt-1" style={{ color }}>
          {currentKicker.name.split(' ').slice(-1)[0]}
          <span style={{ display: 'block', fontSize: '14px', lineHeight: 1 }}>▼</span>
        </p>
      )}
    </div>
  )
}

// ── Goal SVG with 6 clickable zones ─────────────────────────────────────────

const ZONE_RECTS: { id: PenaltyZone; x: number; y: number; w: number; h: number }[] = [
  { id: 'TL', x: 1,  y: 1,  w: 38, h: 43 },
  { id: 'TC', x: 41, y: 1,  w: 38, h: 43 },
  { id: 'TR', x: 81, y: 1,  w: 38, h: 43 },
  { id: 'BL', x: 1,  y: 46, w: 38, h: 43 },
  { id: 'BC', x: 41, y: 46, w: 38, h: 43 },
  { id: 'BR', x: 81, y: 46, w: 38, h: 43 },
]

function GoalSVG({
  onZoneClick,
  disabled,
  shotZone,
  gkZone,
  animating,
}: {
  onZoneClick: (z: PenaltyZone) => void
  disabled: boolean
  shotZone?: PenaltyZone
  gkZone?: PenaltyZone
  animating: boolean
}) {
  return (
    <div className="w-full max-w-[240px]" style={{ filter: 'drop-shadow(0 4px 16px #0009)' }}>
      <svg viewBox="0 0 120 90" width="100%" style={{ display: 'block' }}>
        {/* Background */}
        <rect x="0" y="0" width="120" height="90" fill="#0a0e12" />
        {/* Net grid */}
        {Array.from({ length: 13 }).map((_, i) => (
          <line key={`v${i}`} x1={i * 10} y1="0" x2={i * 10} y2="90" stroke="#161d24" strokeWidth="0.6" />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <line key={`h${i}`} x1="0" y1={i * 10} x2="120" y2={i * 10} stroke="#161d24" strokeWidth="0.6" />
        ))}

        {/* Zone fills */}
        {ZONE_RECTS.map(z => {
          const isShot = shotZone === z.id
          const isGK = gkZone === z.id
          const isHover = !disabled && !isShot && !isGK
          return (
            <g key={z.id}>
              <rect
                x={z.x} y={z.y} width={z.w} height={z.h}
                fill={
                  isShot ? '#75ff9e44'
                  : isGK ? '#ffb4ab33'
                  : 'transparent'
                }
                stroke={
                  isShot ? '#75ff9e99'
                  : isGK ? '#ffb4ab66'
                  : '#2a3a2a55'
                }
                strokeWidth="0.5"
                className={isHover ? 'cursor-pointer' : ''}
                onClick={() => !disabled && onZoneClick(z.id)}
                style={
                  animating && isShot
                    ? { animation: 'zone-pulse 0.6s ease-in-out infinite' }
                    : undefined
                }
              />
              {/* Zone labels when active */}
              {!disabled && (
                <text
                  x={z.x + z.w / 2}
                  y={z.y + z.h / 2 + 3}
                  textAnchor="middle"
                  fill="#3b5c3e"
                  fontSize="7"
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {z.id}
                </text>
              )}
              {/* GK glove emoji substitute — red dot */}
              {isGK && (
                <circle
                  cx={z.x + z.w / 2}
                  cy={z.y + z.h / 2}
                  r="5"
                  fill="#ffb4ab"
                  opacity="0.8"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {/* Shot marker */}
              {isShot && !animating && (
                <circle
                  cx={z.x + z.w / 2}
                  cy={z.y + z.h / 2}
                  r="5"
                  fill="#75ff9e"
                  opacity="0.9"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </g>
          )
        })}

        {/* Goal post frame */}
        <rect x="0" y="0" width="120" height="90" fill="none" stroke="#bacbb9" strokeWidth="2.5" />
        {/* Dividers */}
        <line x1="40" y1="0" x2="40" y2="90" stroke="#2a3a2a" strokeWidth="0.8" />
        <line x1="80" y1="0" x2="80" y2="90" stroke="#2a3a2a" strokeWidth="0.8" />
        <line x1="0" y1="45" x2="120" y2="45" stroke="#2a3a2a" strokeWidth="0.8" />
      </svg>
      {/* Zone label tooltip */}
      {!disabled && (
        <p className="text-[9px] text-center text-[#3b4a3d] mt-1">
          Tocá una zona para patear
        </p>
      )}
    </div>
  )
}

function StatusMessage({
  kickStep,
  lastKick,
  nextSide,
  nextKicker,
  rivalName,
}: {
  kickStep: KickStep
  lastKick: KickRecord | null
  nextSide: 'home' | 'away'
  nextKicker: Player | null
  rivalName: string
}) {
  if (kickStep === 'showing-result' && lastKick) {
    const { outcome, side } = lastKick
    const isHome = side === 'home'
    const msgs: Record<PenaltyOutcome, string> = {
      goal: '⚽ ¡GOL!',
      save: '🧤 ¡Atajada!',
      miss: '💨 ¡Afuera!',
      post: '🥅 ¡En el palo!',
    }
    const color =
      outcome === 'goal' && isHome ? '#75ff9e'
      : outcome === 'goal' ? '#ffb4ab'
      : outcome === 'save' ? '#bacbb9'
      : '#859585'

    return (
      <p className="text-body-lg font-bold text-center" style={{ color }}>
        {msgs[outcome]}
      </p>
    )
  }

  if (kickStep === 'animating') {
    return (
      <p className="text-body-sm text-center text-[#859585]">
        {nextSide === 'home' ? 'Pateando...' : `${nextKicker?.name.split(' ').slice(-1)[0] ?? ''}...`}
      </p>
    )
  }

  if (kickStep === 'idle' && nextSide === 'home') {
    return (
      <p className="text-body-sm text-center font-semibold" style={{ color: '#75ff9e' }}>
        ¡Tu turno! Elegí la zona
      </p>
    )
  }

  if (kickStep === 'idle' && nextSide === 'away') {
    return (
      <p className="text-body-sm text-center text-[#859585]">
        Patea {teamDisplayName(rivalName)}...
      </p>
    )
  }

  return null
}

function DoneScreen({
  winner,
  homeGoals,
  awayGoals,
  rivalName,
  onBack,
}: {
  winner: 'home' | 'away'
  homeGoals: number
  awayGoals: number
  rivalName: string
  onBack: () => void
}) {
  const won = winner === 'home'
  return (
    <div
      className="h-svh flex flex-col items-center justify-center gap-6 px-6"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <p
        className="text-label-caps font-bold text-lg tracking-widest"
        style={{ color: won ? '#75ff9e' : '#ffb4ab' }}
      >
        {won ? '🏆 CLASIFICASTE' : '😔 ELIMINADO'}
      </p>
      <div className="flex items-center gap-4 text-center">
        <div>
          <p className="text-label-caps text-[#859585] mb-1">VOS</p>
          <p className="text-[64px] font-black leading-none" style={{ color: won ? '#75ff9e' : '#e1e2ea' }}>
            {homeGoals}
          </p>
        </div>
        <p className="text-[32px] text-[#3b4a3d] font-bold mt-2">—</p>
        <div>
          <p className="text-label-caps text-[#859585] mb-1 truncate max-w-[96px]">
            {teamDisplayName(rivalName).toUpperCase()}
          </p>
          <p className="text-[64px] font-black leading-none text-[#e1e2ea]">{awayGoals}</p>
        </div>
      </div>
      <p className="text-body-sm text-[#859585] text-center">
        {won
          ? `Superaste a ${teamDisplayName(rivalName)} en penales`
          : `${teamDisplayName(rivalName)} te eliminó en la tanda`}
      </p>
      <button
        onClick={onBack}
        className="w-full font-bold py-4 rounded-xl text-body-lg mt-4 transition-all"
        style={{ background: '#1d2025', border: '1px solid #3b4a3d', color: '#e1e2ea' }}
      >
        Ir al inicio
      </button>
    </div>
  )
}

// ── Zone label tooltip ────────────────────────────────────────────────────────
// Exported for potential reuse in tooltips
export { ZONE_LABEL }
