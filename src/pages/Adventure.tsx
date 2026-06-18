import { useMemo, useState } from 'react'
import { simulateMatch } from '../lib/simulation'
import { teamDisplayName } from '../lib/players'
import type { MatchEvent, MatchResult } from '../lib/simulation'
import type { Player, RivalTeam } from '../types'

const ROUND_LABELS = ['Cuartos de Final', 'Semifinal', 'Final']

interface Props {
  squad: Player[]
  rivals: RivalTeam[]
  dateSeed: number
  onBack: () => void
  onReplay: () => void
}

export default function Adventure({ squad, rivals, dateSeed, onBack, onReplay }: Props) {
  const [round, setRound] = useState(0)
  const [showResult, setShowResult] = useState(false)

  const results = useMemo(
    () => rivals.map((rival, i) => simulateMatch(squad, rival, dateSeed + i * 100)),
    [squad, rivals, dateSeed],
  )

  const current = results[round]
  const currentRival = rivals[round]

  const points = results
    .slice(0, showResult && round === rivals.length - 1 ? rivals.length : round)
    .reduce((acc, r) => acc + (r.myGoals > r.rivalGoals ? 3 : r.myGoals === r.rivalGoals ? 1 : 0), 0)

  const isLast = round === rivals.length - 1

  if (showResult && isLast) {
    return <FinalSummary results={results} rivals={rivals} points={points} onBack={onBack} onReplay={onReplay} />
  }

  if (showResult) {
    const won = current.myGoals > current.rivalGoals
    const drew = current.myGoals === current.rivalGoals
    const outcomeColor = won ? '#75ff9e' : drew ? '#ffde6e' : '#ffb4ab'
    const outcomeLabel = won ? '🏆 VICTORIA' : drew ? '🤝 EMPATE' : '😔 DERROTA'

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
            <p className="text-body-sm font-semibold text-[#e1e2ea]">🎮 Aventura</p>
            <p className="text-label-caps text-[#859585]">{ROUND_LABELS[round]}</p>
          </div>
        </header>

        <div className="shrink-0 px-4 py-6 text-center">
          <p className="text-label-caps mb-3 font-bold" style={{ color: outcomeColor }}>
            {outcomeLabel}
          </p>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-label-caps text-[#859585] mb-1">VOS</p>
              <p className="text-[72px] font-black leading-none" style={{ color: outcomeColor }}>
                {current.myGoals}
              </p>
            </div>
            <p className="text-headline-lg text-[#3b4a3d] font-bold mt-4">—</p>
            <div className="text-center">
              <p className="text-label-caps text-[#859585] mb-1 truncate max-w-[100px]">
                {teamDisplayName(currentRival.name).toUpperCase()}
              </p>
              <p className="text-[72px] font-black leading-none text-[#e1e2ea]">
                {current.rivalGoals}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-2 dark-scrollbar">
          <p className="text-label-caps text-[#859585] px-1 mb-1">CRÓNICA</p>
          {current.events.map((event, i) => (
            <EventRow key={i} event={event} />
          ))}
        </div>

        <div
          className="shrink-0 px-4 py-4 border-t"
          style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
        >
          <button
            onClick={() => { setRound(r => r + 1); setShowResult(false) }}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            Siguiente partido →
          </button>
        </div>
      </div>
    )
  }

  return (
    <MatchPreview
      round={round}
      rival={currentRival}
      onSimulate={() => setShowResult(true)}
      onBack={onBack}
    />
  )
}

function MatchPreview({
  round,
  rival,
  onSimulate,
  onBack,
}: {
  round: number
  rival: RivalTeam
  onSimulate: () => void
  onBack: () => void
}) {
  return (
    <div
      className="h-svh flex flex-col items-center justify-center px-4 gap-8"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <div className="text-center">
        <p className="text-label-caps text-[#75ff9e] tracking-widest mb-2">
          🎮 AVENTURA · {ROUND_LABELS[round].toUpperCase()}
        </p>
        <h2 className="text-headline-lg text-[#e1e2ea]">Próximo rival</h2>
      </div>

      <div className="surface-card rounded-2xl p-6 w-full max-w-sm text-center">
        <p className="text-label-caps text-[#bacbb9] mb-3 tracking-widest">RIVAL</p>
        <p className="text-headline-lg text-[#e1e2ea]">{teamDisplayName(rival.name)}</p>
        <p className="text-body-sm text-[#859585] mt-1">{rival.formation}</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        <button
          onClick={onSimulate}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          ⚽ Jugar partido
        </button>
        <button
          onClick={onBack}
          className="w-full font-bold py-3 rounded-xl text-body-sm transition-all text-[#bacbb9]"
          style={{ background: 'transparent', border: '1px solid #3b4a3d' }}
        >
          Abandonar
        </button>
      </div>
    </div>
  )
}

function FinalSummary({
  results,
  rivals,
  points,
  onBack,
  onReplay,
}: {
  results: MatchResult[]
  rivals: RivalTeam[]
  points: number
  onBack: () => void
  onReplay: () => void
}) {
  const champion = points >= 7

  return (
    <div
      className="h-svh flex flex-col"
      style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}
    >
      <header
        className="shrink-0 flex items-center justify-center px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <p className="text-body-sm font-semibold text-[#e1e2ea]">🎮 Fin de la Aventura</p>
      </header>

      <div className="shrink-0 px-4 py-8 text-center">
        <p className="text-[56px] mb-2">{champion ? '🏆' : '😔'}</p>
        <p
          className="text-headline-lg font-black"
          style={{ color: champion ? '#75ff9e' : '#ffb4ab' }}
        >
          {champion ? '¡Campeón!' : 'Hasta la próxima'}
        </p>
        <p className="text-body-sm text-[#859585] mt-2">
          {points} puntos de 9 posibles
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-3 dark-scrollbar">
        <p className="text-label-caps text-[#859585] px-1 mb-1">RESULTADOS</p>
        {results.map((r, i) => {
          const won = r.myGoals > r.rivalGoals
          const drew = r.myGoals === r.rivalGoals
          const color = won ? '#75ff9e' : drew ? '#ffde6e' : '#ffb4ab'
          return (
            <div
              key={i}
              className="flex items-center gap-3 p-4 rounded-xl"
              style={{ background: '#1d2025', border: '1px solid #272a30' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-label-caps text-[#859585]">{ROUND_LABELS[i]}</p>
                <p className="text-body-sm text-[#e1e2ea] truncate">
                  vs {teamDisplayName(rivals[i].name)}
                </p>
              </div>
              <p className="text-body-sm font-bold shrink-0" style={{ color }}>
                {r.myGoals} — {r.rivalGoals}
              </p>
            </div>
          )
        })}
      </div>

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
    </div>
  )
}

function EventRow({ event }: { event: MatchEvent }) {
  const isHome = event.side === 'home'
  const icon = event.type === 'goal' ? '⚽' : '🟨'
  const typeLabel = event.type === 'goal' ? 'GOL' : 'Amarilla'

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ background: '#191c21', border: '1px solid #272a30' }}
    >
      <span className="text-label-caps text-[#859585] w-8 text-right shrink-0">
        {event.minute}'
      </span>
      <span className="text-base shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p
          className={`text-body-sm font-semibold truncate ${
            isHome ? 'text-[#75ff9e]' : 'text-[#e1e2ea]'
          }`}
        >
          {event.playerName}
        </p>
        <p className="text-label-caps text-[#859585]">
          {isHome ? 'Tu equipo' : 'Rival'} · {typeLabel}
        </p>
      </div>
    </div>
  )
}
