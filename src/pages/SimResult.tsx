import { useState, useEffect } from 'react'
import type { MatchResult, MatchEvent, EventType } from '../lib/simulation'
import type { RivalTeam } from '../types'
import { teamDisplayName } from '../lib/players'

interface Props {
  result: MatchResult
  rival: RivalTeam
  onBack: () => void
  onReplay: () => void
}

export default function SimResult({ result, rival, onBack, onReplay }: Props) {
  const [visibleCount, setVisibleCount] = useState(0)
  const isLive = visibleCount < result.events.length
  const visibleEvents = result.events.slice(0, visibleCount)

  const liveMyGoals = visibleEvents.filter(e => e.type === 'goal' && e.side === 'home').length
  const liveRivalGoals = visibleEvents.filter(e => e.type === 'goal' && e.side === 'away').length

  useEffect(() => {
    if (visibleCount >= result.events.length) return
    const id = setTimeout(() => setVisibleCount(c => c + 1), 4000)
    return () => clearTimeout(id)
  }, [visibleCount, result.events.length])

  const finalMyGoals = isLive ? liveMyGoals : result.myGoals
  const finalRivalGoals = isLive ? liveRivalGoals : result.rivalGoals

  const won = result.myGoals > result.rivalGoals
  const drew = result.myGoals === result.rivalGoals
  const outcomeLabel = won ? '🏆 VICTORIA' : drew ? '🤝 EMPATE' : '😔 DERROTA'
  const outcomeColor = won ? '#75ff9e' : drew ? '#ffde6e' : '#ffb4ab'

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
          {isLive ? (
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
        {!isLive && (
          <p className="text-label-caps mb-3 font-bold" style={{ color: outcomeColor }}>
            {outcomeLabel}
          </p>
        )}
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1">VOS</p>
            <p
              className="text-[72px] font-black leading-none transition-all"
              style={{ color: isLive ? '#e1e2ea' : outcomeColor }}
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
        {!isLive && (
          <div className="mt-3 flex justify-center gap-6 text-label-caps text-[#859585]">
            <span>
              Tu equipo: <span className="text-[#75ff9e]">{result.myOverall}</span>
            </span>
            <span>
              Rival: <span className="text-[#e1e2ea]">{result.rivalOverall}</span>
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-2 dark-scrollbar">
        <p className="text-label-caps text-[#859585] px-1 mb-1">CRÓNICA DEL PARTIDO</p>
        {visibleEvents.map((event, i) => (
          <EventRow key={i} event={event} isNew={i === visibleCount - 1} />
        ))}
        {isLive && (
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
        {!isLive && result.events.length === 0 && (
          <p className="text-center py-8 text-body-sm text-[#859585]">Sin eventos destacados</p>
        )}
      </div>

      {!isLive && (
        <div
          className="shrink-0 px-4 py-4 border-t flex flex-col gap-2"
          style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
        >
          <button
            onClick={onReplay}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            🔄 Volver a armar equipo
          </button>
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
  goal:     { icon: '⚽', label: (p)        => `¡GOL de ${p}!`,                highlight: '#75ff9e44' },
  save:     { icon: '🧤', label: (p)        => `Tiro de ${p}, atajada`,         highlight: '#272a30'   },
  shot_off: { icon: '💨', label: (p)        => `${p} tira afuera`,              highlight: '#272a30'   },
  corner:   { icon: '🚩', label: (p)        => `Córner — ataque de ${p}`,       highlight: '#272a30'   },
  offside:  { icon: '🏃', label: (p)        => `${p} en offside`,               highlight: '#272a30'   },
  foul:     { icon: '⚠️', label: (p)        => `Falta de ${p}`,                highlight: '#272a30'   },
  yellow:   { icon: '🟨', label: (p)        => `Amarilla para ${p}`,            highlight: '#272a30'   },
}

function EventRow({ event, isNew }: { event: MatchEvent; isNew: boolean }) {
  const isHome = event.side === 'home'
  const meta = EVENT_META[event.type]
  const isGoal = event.type === 'goal'

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{
        background: '#1d2025',
        border: `1px solid ${isNew ? meta.highlight : '#272a30'}`,
        animation: isNew ? 'event-in 0.3s ease-out' : undefined,
      }}
    >
      <span className="text-label-caps text-[#859585] w-8 text-right shrink-0">
        {event.minute}'
      </span>
      <span className="text-base shrink-0">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p
          className={`text-body-sm font-semibold truncate ${
            isGoal
              ? isHome ? 'text-[#75ff9e]' : 'text-[#ffb4ab]'
              : isHome ? 'text-[#e1e2ea]' : 'text-[#bacbb9]'
          }`}
        >
          {meta.label(event.playerName, isHome)}
        </p>
        <p className="text-label-caps text-[#859585]">
          {isHome ? 'Tu equipo' : 'Rival'}
        </p>
      </div>
    </div>
  )
}
