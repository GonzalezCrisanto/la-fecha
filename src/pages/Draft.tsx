import { useEffect, useState } from 'react'
import {
  loadPlayers, getDailyChallenge, playersByPosition,
  SQUAD_SLOTS, BUDGET, MAX_PER_CLUB, teamDisplayName,
} from '../lib/players'
import type { Player, Position, GameMode, DailyChallenge } from '../types'

const POSITIONS: Position[] = ['ARQ', 'DEF', 'MED', 'DEL']

const BADGE_CLASS: Record<Position, string> = {
  ARQ: 'badge-arq',
  DEF: 'badge-def',
  MED: 'badge-med',
  DEL: 'badge-del',
}

interface Props {
  mode: GameMode
  onBack: () => void
  onConfirm: (squad: Player[]) => void
}

export default function Draft({ mode, onBack, onConfirm }: Props) {
  const [allPlayers, setAllPlayers] = useState<Player[]>([])
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null)
  const [squad, setSquad] = useState<Player[]>([])
  const [activePos, setActivePos] = useState<Position>('ARQ')
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadPlayers().then(players => {
      setAllPlayers(players)
      setChallenge(getDailyChallenge(players))
    })
  }, [])

  const budget = BUDGET - squad.reduce((sum, p) => sum + p.value, 0)
  const isComplete = POSITIONS.every(
    pos => squad.filter(p => p.position === pos).length === SQUAD_SLOTS[pos]
  )

  function canAdd(player: Player): boolean {
    if (squad.find(p => p.id === player.id)) return false
    if (challenge?.blockedPlayerIds.includes(player.id)) return false
    if (squad.filter(p => p.position === player.position).length >= SQUAD_SLOTS[player.position]) return false
    if (squad.filter(p => p.team === player.team).length >= MAX_PER_CLUB) return false
    if (player.value > budget) return false
    return true
  }

  function togglePlayer(player: Player) {
    if (squad.find(p => p.id === player.id)) {
      setSquad(prev => prev.filter(p => p.id !== player.id))
    } else if (canAdd(player)) {
      setSquad(prev => [...prev, player])
    }
  }

  const pool = playersByPosition(allPlayers, activePos)
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    .filter(p => !challenge?.blockedPlayerIds.includes(p.id))

  const slotsFilled = squad.filter(p => p.position === activePos).length
  const slotsNeeded = SQUAD_SLOTS[activePos]

  return (
    // h-svh + flex-col → toda la pantalla, sin scroll de página
    <div className="h-svh flex flex-col" style={{ background: '#101319', maxWidth: '640px', margin: '0 auto', width: '100%' }}>

      {/* ── Header ── */}
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button
          onClick={onBack}
          className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea] transition-colors shrink-0"
        >
          ← Volver
        </button>
        <div className="flex-1 text-center min-w-0 px-2">
          <p className="text-body-sm font-semibold text-[#e1e2ea]">
            {mode === 'sim' ? '⚡ Simulación' : '🎮 Aventura'}
          </p>
          {challenge && (
            <p className="text-label-caps text-[#859585] truncate">
              vs {teamDisplayName(challenge.rival.name)}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-label-caps text-[#859585]">presupuesto</p>
          <p className={`text-body-sm font-bold ${budget < 20 ? 'text-[#ffb4ab]' : 'text-[#75ff9e]'}`}>
            ${budget}
          </p>
        </div>
      </header>

      {/* ── Tabs de posición ── */}
      <nav
        className="shrink-0 flex border-b"
        style={{ background: '#191c21', borderColor: '#3b4a3d' }}
      >
        {POSITIONS.map(pos => {
          const filled = squad.filter(p => p.position === pos).length
          const total = SQUAD_SLOTS[pos]
          const done = filled === total
          return (
            <button
              key={pos}
              onClick={() => { setActivePos(pos); setSearch('') }}
              className={`flex-1 py-3 text-body-sm font-bold transition-colors ${
                activePos === pos
                  ? 'text-[#75ff9e] border-b-2 border-[#75ff9e]'
                  : 'text-[#859585] hover:text-[#bacbb9]'
              }`}
            >
              {pos}
              <span className={`ml-1 text-label-caps ${done ? 'text-[#75ff9e]' : 'text-[#32353b]'}`}>
                {filled}/{total}
              </span>
            </button>
          )
        })}
      </nav>

      {/* ── Búsqueda + estado ── */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex flex-col gap-1" style={{ background: '#101319' }}>
        <input
          type="text"
          placeholder="Buscar jugador..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-body-sm text-[#e1e2ea] outline-none transition-colors"
          style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}
          onFocus={e => (e.target.style.borderColor = '#75ff9e')}
          onBlur={e => (e.target.style.borderColor = '#3b4a3d')}
        />
        <p className="text-label-caps text-[#859585] px-1">
          {slotsFilled}/{slotsNeeded} {activePos} · {pool.length} disponibles
        </p>
      </div>

      {/* ── Lista (scroll contenido) ── */}
      {/* min-h-0 es clave: sin él el flex child ignora overflow */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-2 dark-scrollbar">
        {pool.map(player => {
          const inSquad = !!squad.find(p => p.id === player.id)
          const addable = canAdd(player)
          const blocked = !inSquad && !addable

          return (
            <button
              key={player.id}
              onClick={() => togglePlayer(player)}
              disabled={blocked}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                inSquad ? 'glow-active' : ''
              } ${blocked ? 'opacity-35 cursor-not-allowed' : ''}`}
              style={{
                background: inSquad ? 'rgba(117,255,158,0.08)' : '#1d2025',
                border: `1px solid ${inSquad ? '#75ff9e' : '#272a30'}`,
              }}
            >
              <span className={`text-label-caps px-2 py-1 rounded font-bold shrink-0 ${BADGE_CLASS[player.position]}`}>
                {player.position}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-body-sm font-semibold text-[#e1e2ea] truncate">{player.name}</p>
                <p className="text-label-caps text-[#859585] truncate">{teamDisplayName(player.team)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-body-sm font-bold text-[#e1e2ea]">{player.overall}</p>
                <p className="text-label-caps text-[#75ff9e]">${player.value}</p>
              </div>
            </button>
          )
        })}

        {pool.length === 0 && (
          <p className="text-center py-12 text-body-sm text-[#859585]">
            No hay jugadores disponibles
          </p>
        )}
      </div>

      {/* ── CTA ── */}
      {isComplete && (
        <div className="shrink-0 px-4 py-4 border-t" style={{ background: '#1d2025', borderColor: '#3b4a3d' }}>
          <button
            onClick={() => onConfirm(squad)}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            {mode === 'sim' ? '⚡ Simular partido' : '🎮 Comenzar aventura'}
          </button>
        </div>
      )}
    </div>
  )
}
