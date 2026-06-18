import type { MatchResult, MatchEvent } from '../lib/simulation'
import type { RivalTeam } from '../types'
import { teamDisplayName } from '../lib/players'

interface Props {
  result: MatchResult
  rival: RivalTeam
  onBack: () => void
  onReplay: () => void
}

export default function SimResult({ result, rival, onBack, onReplay }: Props) {
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
          <p className="text-body-sm font-semibold text-[#e1e2ea]">⚡ Simulación</p>
        </div>
      </header>

      <div className="shrink-0 px-4 py-6 text-center">
        <p className="text-label-caps mb-3 font-bold" style={{ color: outcomeColor }}>
          {outcomeLabel}
        </p>
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1">VOS</p>
            <p
              className="text-[72px] font-black leading-none"
              style={{ color: outcomeColor }}
            >
              {result.myGoals}
            </p>
          </div>
          <p className="text-headline-lg text-[#3b4a3d] font-bold mt-4">—</p>
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1 truncate max-w-[100px]">
              {teamDisplayName(rival.name).toUpperCase()}
            </p>
            <p className="text-[72px] font-black leading-none text-[#e1e2ea]">
              {result.rivalGoals}
            </p>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-6 text-label-caps text-[#859585]">
          <span>
            Tu equipo: <span className="text-[#75ff9e]">{result.myOverall}</span>
          </span>
          <span>
            Rival: <span className="text-[#e1e2ea]">{result.rivalOverall}</span>
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-2 dark-scrollbar">
        <p className="text-label-caps text-[#859585] px-1 mb-1">CRÓNICA DEL PARTIDO</p>
        {result.events.map((event, i) => (
          <EventRow key={i} event={event} />
        ))}
        {result.events.length === 0 && (
          <p className="text-center py-8 text-body-sm text-[#859585]">Sin eventos destacados</p>
        )}
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
      style={{ background: '#1d2025', border: '1px solid #272a30' }}
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
