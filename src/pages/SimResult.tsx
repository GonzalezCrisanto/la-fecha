import { useState, useEffect } from 'react'
import type { MatchResult, MatchEvent, EventType } from '../lib/simulation'
import { callSimEngineSecondHalf } from '../lib/simulation'
import type { Player, RivalTeam } from '../types'
import { teamDisplayName } from '../lib/players'
import { StrategyPicker } from './Adventure'
import { STRATEGIES } from '../lib/adventure'
import type { GameStrategy } from '../lib/adventure'

interface Props {
  result: MatchResult
  rival: RivalTeam
  squad: Player[]
  seed: number
  initialStrategy: GameStrategy
  remainingAttempts: number
  onBack: () => void
  onReplay: () => void
  onPenalties?: () => void
}

type Phase = 'first' | 'halftime-break' | 'loading-second-half' | 'second'

export default function SimResult({ result, rival, squad, seed, initialStrategy, remainingAttempts, onBack, onReplay, onPenalties }: Props) {
  const [allEvents, setAllEvents] = useState(result.events)
  const [visibleCount, setVisibleCount] = useState(0)
  const [phase, setPhase] = useState<Phase>('first')
  const [htScore, setHtScore] = useState({ home: 0, away: 0 })
  const [halfStrategy, setHalfStrategy] = useState<GameStrategy>(initialStrategy)

  const visibleEvents = allEvents.slice(0, visibleCount)
  const isLive = phase !== 'second' || visibleCount < allEvents.length
  const isDone = phase === 'second' && visibleCount >= allEvents.length

  const liveMyGoals = visibleEvents.filter(e => e.type === 'goal' && e.side === 'home').length
  const liveRivalGoals = visibleEvents.filter(e => e.type === 'goal' && e.side === 'away').length

  useEffect(() => {
    if (phase !== 'first' && phase !== 'second') return
    if (visibleCount >= allEvents.length) return
    const next = allEvents[visibleCount]
    if (next?.type === 'halftime' && phase === 'first') {
      const id = setTimeout(() => {
        const eventsWithHT = allEvents.slice(0, visibleCount + 1)
        const hs = eventsWithHT.filter(e => e.type === 'goal' && e.side === 'home').length
        const as_ = eventsWithHT.filter(e => e.type === 'goal' && e.side === 'away').length
        setHtScore({ home: hs, away: as_ })
        setVisibleCount(c => c + 1)
        setPhase('halftime-break')
      }, 4000)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setVisibleCount(c => c + 1), 4000)
    return () => clearTimeout(id)
  }, [visibleCount, allEvents, phase])

  async function startSecondHalf() {
    if (halfStrategy !== initialStrategy) {
      setPhase('loading-second-half')
      try {
        const firstHalfEvents = allEvents.slice(0, visibleCount)
        const bookedHome = firstHalfEvents
          .filter(e => e.type === 'yellow' && e.side === 'home')
          .map(e => e.playerName)
        const bookedAway = firstHalfEvents
          .filter(e => e.type === 'yellow' && e.side === 'away')
          .map(e => e.playerName)
        const secondHalfEvents = await callSimEngineSecondHalf(
          squad, rival, seed, halfStrategy,
          htScore.home, htScore.away,
          bookedHome, bookedAway,
        )
        setAllEvents([...firstHalfEvents, ...secondHalfEvents])
      } catch {
        // continue with existing events on error
      }
    }
    setPhase('second')
  }

  const won = isDone ? liveMyGoals > liveRivalGoals : result.myGoals > result.rivalGoals
  const drew = isDone ? liveMyGoals === liveRivalGoals : result.myGoals === result.rivalGoals
  const outcomeLabel = won ? '🏆 VICTORIA' : drew ? '🤝 EMPATE' : '😔 DERROTA'
  const outcomeColor = won ? '#75ff9e' : drew ? '#ffde6e' : '#ffb4ab'

  const finalMyGoals = isLive ? liveMyGoals : (isDone ? liveMyGoals : result.myGoals)
  const finalRivalGoals = isLive ? liveRivalGoals : (isDone ? liveRivalGoals : result.rivalGoals)

  const cfg = STRATEGIES[halfStrategy]

  return (
    <div
      className="h-svh flex flex-col"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button
          onClick={onBack}
          className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea] transition-colors"
        >
          ← Inicio
        </button>
        <div className="flex-1 text-center">
          {phase === 'halftime-break' ? (
            <span className="text-label-caps font-bold text-[#ffde6e]">⏸ ENTRETIEMPO</span>
          ) : isLive ? (
            <span className="inline-flex items-center gap-1.5 text-label-caps font-bold text-[#ff5252]">
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#ff5252] inline-block"
                style={{ animation: 'live-pulse 1s ease-in-out infinite' }}
              />
              EN VIVO
            </span>
          ) : (
            <p className="text-body-sm font-semibold text-[#e1e2ea]">⚡ Simulación</p>
          )}
        </div>
      </header>

      <div className="shrink-0 px-4 py-6 text-center">
        {isDone && (
          <p className="text-label-caps mb-3 font-bold" style={{ color: outcomeColor }}>
            {outcomeLabel}
          </p>
        )}
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1">VOS</p>
            <p
              className="text-[72px] font-black leading-none transition-all"
              style={{ color: isDone ? outcomeColor : '#e1e2ea' }}
            >
              {finalMyGoals}
            </p>
          </div>
          <p className="text-headline-lg text-[#3b4a3d] font-bold mt-4">—</p>
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1 truncate max-w-[100px]">
              {teamDisplayName(rival.name).toUpperCase()}
            </p>
            <p className="text-[72px] font-black leading-none text-[#e1e2ea]">
              {finalRivalGoals}
            </p>
          </div>
        </div>
        {isDone && (
          <div className="mt-3 flex justify-center gap-6 text-label-caps text-[#859585]">
            <span>Tu equipo: <span className="text-[#75ff9e]">{result.myOverall}</span></span>
            <span>Rival: <span className="text-[#e1e2ea]">{result.rivalOverall}</span></span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-2 dark-scrollbar">
        <p className="text-label-caps text-[#859585] px-1 mb-1">CRÓNICA DEL PARTIDO</p>
        {visibleEvents.map((event, i) => (
          <EventRow key={i} event={event} isNew={i === visibleCount - 1} />
        ))}
        {(phase === 'first' || phase === 'second') && visibleCount < allEvents.length && (
          <div
            className="flex items-center gap-2 p-3 rounded-xl"
            style={{ background: '#1d2025', border: '1px solid #272a30' }}
          >
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-[#859585]"
                  style={{ animation: `dot-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
            <span className="text-body-sm text-[#859585]">Partido en curso…</span>
          </div>
        )}
        {isDone && allEvents.length === 0 && (
          <p className="text-center py-8 text-body-sm text-[#859585]">Sin eventos destacados</p>
        )}
      </div>

      {/* Halftime break panel */}
      {phase === 'halftime-break' && (
        <div
          className="shrink-0 px-4 pt-4 pb-5 border-t flex flex-col gap-4"
          style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
        >
          <div>
            <p className="text-label-caps text-[#ffde6e] mb-1">DESCANSO · ELEGÍ TU TÁCTICA PARA EL ST</p>
            <p className="text-body-sm text-[#859585]">Podés mantener o cambiar la estrategia para el segundo tiempo.</p>
          </div>
          <StrategyPicker current={halfStrategy} onSelect={setHalfStrategy} />
          {cfg && (
            <div
              className="rounded-xl px-4 py-3 flex flex-col gap-0.5"
              style={{ background: '#101319', border: '1px solid #3b4a3d' }}
            >
              <p className="text-body-sm font-bold text-[#e1e2ea] mb-1">{cfg.label}</p>
              {cfg.pros.map(p => <p key={p} className="text-label-caps" style={{ color: '#75ff9e', fontSize: '11px' }}>{p}</p>)}
              {cfg.cons.map(c => <p key={c} className="text-label-caps" style={{ color: '#ffb4ab', fontSize: '11px' }}>{c}</p>)}
            </div>
          )}
          <button
            onClick={startSecondHalf}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            {halfStrategy !== initialStrategy ? '🔄 Cambiar táctica y arrancar ST →' : 'Arrancar segundo tiempo →'}
          </button>
        </div>
      )}

      {/* Loading second half */}
      {phase === 'loading-second-half' && (
        <div
          className="shrink-0 px-4 py-5 border-t flex items-center justify-center gap-3"
          style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
        >
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-[#75ff9e]"
                style={{ animation: `dot-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <span className="text-body-sm text-[#75ff9e]">Simulando segundo tiempo…</span>
        </div>
      )}

      {/* Final actions */}
      {isDone && (
        <div
          className="shrink-0 px-4 py-4 border-t flex flex-col gap-2"
          style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
        >
          {drew && onPenalties && (
            <button
              onClick={onPenalties}
              className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
              style={{ background: '#ffde6e', color: '#2a1f00' }}
            >
              🥅 Ir a penales →
            </button>
          )}
          {!drew && onPenalties && (
            <button
              onClick={onPenalties}
              className="w-full py-3 rounded-xl text-body-sm transition-all text-[#859585]"
              style={{ background: 'transparent', border: '1px dashed #3b4a3d' }}
            >
              🧪 Probar penales
            </button>
          )}
          {remainingAttempts > 0 ? (
            <button
              onClick={onReplay}
              className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
              style={{ background: '#75ff9e', color: '#003918' }}
            >
              🔄 Volver a armar equipo
              <span className="ml-2 text-label-caps opacity-70">
                ({remainingAttempts} {remainingAttempts === 1 ? 'chance' : 'chances'})
              </span>
            </button>
          ) : (
            <div
              className="w-full py-4 rounded-xl text-center text-body-sm text-[#859585]"
              style={{ background: '#191c21', border: '1px solid #3b4a3d' }}
            >
              Sin más chances hoy · Volvé mañana
            </div>
          )}
          <button
            onClick={onBack}
            className="w-full font-bold py-3 rounded-xl text-body-sm transition-all text-[#bacbb9]"
            style={{ background: 'transparent', border: '1px solid #3b4a3d' }}
          >
            Ir al inicio
          </button>
        </div>
      )}

      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }
        @keyframes event-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

const EVENT_META: Record<EventType, { icon: string; label: (player: string, isHome: boolean) => string; highlight: string }> = {
  goal:     { icon: '⚽', label: (p)  => `¡GOL de ${p}!`,          highlight: '#75ff9e44' },
  save:     { icon: '🧤', label: (p)  => `Atajada de ${p}`,         highlight: '#1a2a3a'   },
  shot_off: { icon: '💨', label: (p)  => `${p} tira afuera`,        highlight: '#272a30'   },
  corner:   { icon: '🚩', label: (p)  => `Córner — ataque de ${p}`, highlight: '#272a30'   },
  offside:  { icon: '🏃', label: (p)  => `${p} en offside`,         highlight: '#272a30'   },
  foul:     { icon: '⚠️', label: (p)  => `Falta de ${p}`,          highlight: '#272a30'   },
  yellow:        { icon: '🟨',    label: (p) => `Amarilla para ${p}`,       highlight: '#2a2500' },
  double_yellow: { icon: '🟨🟥', label: (p) => `¡Doble amarilla! ${p}`,    highlight: '#3a0a0a' },
  red:           { icon: '🟥',    label: (p) => `¡Expulsado! ${p}`,        highlight: '#3a0a0a' },
  halftime: { icon: '⏸',  label: ()   => 'Fin del primer tiempo',   highlight: '#1d2025'   },
  fulltime: { icon: '🏁', label: ()   => 'Pitazo final',            highlight: '#1d2025'   },
  motm:     { icon: '⭐', label: (p)  => `Figura: ${p}`,            highlight: '#2a2500'   },
}

function EventRow({ event, isNew }: { event: MatchEvent; isNew: boolean }) {
  const isHome   = event.side === 'home'
  const meta     = EVENT_META[event.type]
  const isGoal   = event.type === 'goal'
  const isGlobal = event.type === 'halftime' || event.type === 'fulltime' || event.type === 'motm'

  const minuteLabel = event.type === 'halftime' ? "45'" : event.type === 'fulltime' ? "90'" : `${event.minute}'`

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-xl"
      style={{
        background: isGlobal ? '#151a1e' : '#1d2025',
        border: `1px solid ${isNew ? meta.highlight : '#272a30'}`,
        animation: isNew ? 'event-in 0.3s ease-out' : undefined,
      }}
    >
      <span className="text-label-caps text-[#859585] w-8 text-right shrink-0 mt-0.5">
        {minuteLabel}
      </span>
      <span className="text-base shrink-0 mt-0.5">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        {event.text ? (
          <p className={`text-body-sm leading-snug ${
            isGoal
              ? isHome ? 'text-[#75ff9e] font-semibold' : 'text-[#ffb4ab] font-semibold'
              : isGlobal ? 'text-[#859585] italic'
              : 'text-[#e1e2ea]'
          }`}>
            {event.text}
          </p>
        ) : (
          <>
            <p className={`text-body-sm font-semibold truncate ${
              isGoal
                ? isHome ? 'text-[#75ff9e]' : 'text-[#ffb4ab]'
                : isHome ? 'text-[#e1e2ea]' : 'text-[#bacbb9]'
            }`}>
              {meta.label(event.playerName, isHome)}
            </p>
            {!isGlobal && (
              <p className="text-label-caps text-[#859585]">
                {isHome ? 'Tu equipo' : 'Rival'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
