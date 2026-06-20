import { useEffect, useState } from 'react'
import {
  loadPlayers, getDailyChallenge, getAdventureRivals, playersByPosition,
  FORMATION_SLOTS, BUDGET, MAX_PER_CLUB, teamDisplayName,
} from '../lib/players'
import type { Player, Position, GameMode, DailyChallenge, Formation } from '../types'

const POSITIONS: Position[] = ['ARQ', 'DEF', 'MED', 'DEL']
const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '3-4-3', '5-3-2']

const BADGE_CLASS: Record<Position, string> = {
  ARQ: 'badge-arq',
  DEF: 'badge-def',
  MED: 'badge-med',
  DEL: 'badge-del',
}

interface Props {
  mode: GameMode
  onBack: () => void
  onConfirm: (squad: Player[], formation: Formation) => void
}

export default function Draft({ mode, onBack, onConfirm }: Props) {
  const [allPlayers, setAllPlayers]     = useState<Player[]>([])
  const [challenge, setChallenge]       = useState<DailyChallenge | null>(null)
  const [formation, setFormation]       = useState<Formation>('4-3-3')
  const [pendingFormation, setPending]  = useState<Formation | null>(null)
  const [squad, setSquad]               = useState<Player[]>([])
  const [activePos, setActivePos]       = useState<Position>('ARQ')
  const [search, setSearch]             = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)

  const slots = FORMATION_SLOTS[formation]

  useEffect(() => {
    loadPlayers().then(players => {
      setAllPlayers(players)
      if (mode === 'adventure') {
        const rivals = getAdventureRivals(players)
        const blockedIds = rivals.flatMap(r => r.players.map(p => p.id))
        setChallenge({
          date: new Date().toISOString().slice(0, 10),
          rival: rivals[0],
          blockedPlayerIds: blockedIds,
        })
      } else if (mode === 'multiplayer') {
        setChallenge({
          date: new Date().toISOString().slice(0, 10),
          rival: { name: 'Rival', players: [], formation: '4-3-3' },
          blockedPlayerIds: [],
        })
      } else {
        setChallenge(getDailyChallenge(players))
      }
    })
  }, [])

  const budget = BUDGET - squad.reduce((sum, p) => sum + p.value, 0)
  const isComplete = POSITIONS.every(pos => squad.filter(p => p.position === pos).length === slots[pos])

  function selectFormation(f: Formation) {
    setFormation(f)
    setSquad([])
    setActivePos('ARQ')
    setSearch('')
    setPending(null)
  }

  function requestFormationChange(f: Formation) {
    if (f === formation) return
    if (squad.length > 0) setPending(f)
    else selectFormation(f)
  }

  type BlockReason = 'slot' | 'club' | 'budget'

  function getBlockReason(player: Player): BlockReason | null {
    if (squad.filter(p => p.position === player.position).length >= slots[player.position]) return 'slot'
    if (squad.filter(p => p.team === player.team).length >= MAX_PER_CLUB) return 'club'
    if (player.value > budget) return 'budget'
    return null
  }

  function canAdd(player: Player): boolean {
    if (squad.find(p => p.id === player.id)) return false
    if (challenge?.blockedPlayerIds.includes(player.id)) return false
    return getBlockReason(player) === null
  }

  function togglePlayer(player: Player) {
    if (squad.find(p => p.id === player.id)) {
      setSquad(prev => prev.filter(p => p.id !== player.id))
    } else if (canAdd(player)) {
      const next = [...squad, player]
      setSquad(next)
      // Auto-advance to next incomplete position
      const posNowFull = next.filter(p => p.position === player.position).length >= slots[player.position]
      if (posNowFull) {
        const nextPos = POSITIONS.find(pos => next.filter(p => p.position === pos).length < slots[pos])
        if (nextPos) { setActivePos(nextPos); setSearch('') }
      }
    }
  }

  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const q = normalize(search)

  const pool = playersByPosition(allPlayers, activePos)
    .filter(p => !q || normalize(p.name).includes(q) || normalize(p.team).includes(q))
    .filter(p => !challenge?.blockedPlayerIds.includes(p.id))
    .filter(p => !onlyAvailable || canAdd(p) || !!squad.find(s => s.id === p.id))

  const slotsFilled  = squad.filter(p => p.position === activePos).length
  const slotsNeeded  = slots[activePos]
  const totalFilled  = squad.length
  const totalNeeded  = POSITIONS.reduce((s, pos) => s + slots[pos], 0)

  const BLOCK_LABEL: Record<string, string> = {
    slot:   'slot lleno',
    club:   'máx. 3 club',
    budget: 'sin fondos',
  }

  return (
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
            {mode === 'sim' ? '⚡ Simulación' : mode === 'adventure' ? '🎮 Aventura' : '🤝 Multijugador'}
          </p>
          {challenge && mode !== 'multiplayer' && (
            <p className="text-label-caps text-[#859585] truncate">
              vs {teamDisplayName(challenge.rival.name)}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right flex flex-col items-end gap-1">
          <p className={`text-body-sm font-bold ${budget < 20 ? 'text-[#ffb4ab]' : 'text-[#75ff9e]'}`}>
            ${budget}
          </p>
          {squad.length > 0 && (
            <button
              onClick={() => { setSquad([]); setActivePos('ARQ'); setSearch('') }}
              className="text-label-caps text-[#859585] hover:text-[#ffb4ab] transition-colors"
            >
              limpiar
            </button>
          )}
        </div>
      </header>

      {/* ── Formación ── */}
      <div
        className="shrink-0 px-4 py-2 border-b"
        style={{ background: '#191c21', borderColor: '#272a30' }}
      >
        {pendingFormation ? (
          <div className="py-1">
            <p className="text-body-sm text-[#ffde6e] font-semibold mb-2">
              ¿Cambiar a {pendingFormation}? Se borrará el equipo actual.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => selectFormation(pendingFormation)}
                className="px-4 py-1.5 rounded-lg text-body-sm font-bold"
                style={{ background: '#ffde6e22', border: '1px solid #ffde6e', color: '#ffde6e' }}
              >
                Confirmar
              </button>
              <button
                onClick={() => setPending(null)}
                className="px-4 py-1.5 rounded-lg text-body-sm font-bold"
                style={{ background: '#1d2025', border: '1px solid #3b4a3d', color: '#859585' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-label-caps text-[#859585] mb-2">FORMACIÓN</p>
            <div className="flex gap-2 pb-1 overflow-x-auto">
              {FORMATIONS.map(f => (
                <button
                  key={f}
                  onClick={() => requestFormationChange(f)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-body-sm font-bold transition-all"
                  style={{
                    background: formation === f ? '#75ff9e22' : '#1d2025',
                    border: `1px solid ${formation === f ? '#75ff9e' : '#3b4a3d'}`,
                    color: formation === f ? '#75ff9e' : '#859585',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Tabs de posición ── */}
      <nav
        className="shrink-0 flex border-b"
        style={{ background: '#191c21', borderColor: '#3b4a3d' }}
      >
        {POSITIONS.map(pos => {
          const filled = squad.filter(p => p.position === pos).length
          const total  = slots[pos]
          const done   = filled === total
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
      <div className="shrink-0 px-4 pt-3 pb-2 flex flex-col gap-2" style={{ background: '#101319' }}>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Buscar jugador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 text-body-sm text-[#e1e2ea] outline-none transition-colors"
            style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}
            onFocus={e => (e.target.style.borderColor = '#75ff9e')}
            onBlur={e => (e.target.style.borderColor = '#3b4a3d')}
          />
          <button
            onClick={() => setOnlyAvailable(v => !v)}
            className="shrink-0 px-3 py-2 rounded-lg text-label-caps font-bold transition-all"
            style={{
              background: onlyAvailable ? '#75ff9e22' : '#1d2025',
              border: `1px solid ${onlyAvailable ? '#75ff9e' : '#3b4a3d'}`,
              color: onlyAvailable ? '#75ff9e' : '#859585',
            }}
          >
            disponibles
          </button>
        </div>
        <p className="text-label-caps text-[#859585] px-1">
          {slotsFilled}/{slotsNeeded} {activePos} · {pool.length} en lista
        </p>
      </div>

      {/* ── Lista ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 flex flex-col gap-2 dark-scrollbar">
        {pool.map(player => {
          const inSquad     = !!squad.find(p => p.id === player.id)
          const reason      = !inSquad ? getBlockReason(player) : null
          const blocked     = reason !== null
          const clubInSquad = squad.filter(p => p.team === player.team).length

          return (
            <button
              key={player.id}
              onClick={() => togglePlayer(player)}
              disabled={blocked}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                inSquad ? 'glow-active' : ''
              } ${blocked ? 'opacity-40 cursor-not-allowed' : ''}`}
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
                <p className="text-label-caps text-[#859585] truncate">
                  {teamDisplayName(player.team)}
                  {clubInSquad > 0 && (
                    <span style={{ color: clubInSquad >= MAX_PER_CLUB ? '#ffb4ab' : '#75ff9e66' }}>
                      {' '}· {clubInSquad}/{MAX_PER_CLUB}
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-body-sm font-bold text-[#e1e2ea]">{player.overall}</p>
                {blocked ? (
                  <p className="text-label-caps" style={{ color: reason === 'budget' ? '#ffb4ab' : '#556655' }}>
                    {BLOCK_LABEL[reason]}
                  </p>
                ) : (
                  <p className="text-label-caps text-[#75ff9e]">${player.value}</p>
                )}
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

      {/* ── CTA / Progreso ── */}
      <div className="shrink-0 px-4 py-4 border-t" style={{ background: '#1d2025', borderColor: '#3b4a3d' }}>
        {isComplete ? (
          <button
            onClick={() => onConfirm(squad, formation)}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            {mode === 'sim' ? '⚡ Simular partido' : mode === 'adventure' ? '🎮 Comenzar aventura' : '🤝 Enviar equipo'}
          </button>
        ) : (
          <div className="flex items-center justify-between px-1">
            <p className="text-label-caps text-[#859585]">
              {totalFilled}/{totalNeeded} jugadores seleccionados
            </p>
            <div className="flex gap-1">
              {POSITIONS.map(pos => {
                const f = squad.filter(p => p.position === pos).length
                const t = slots[pos]
                return Array.from({ length: t }, (_, i) => (
                  <span
                    key={`${pos}-${i}`}
                    className="w-2 h-2 rounded-full"
                    style={{ background: i < f ? '#75ff9e' : '#272a30' }}
                  />
                ))
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
