import type { Player, RivalTeam } from '../types'

export type EventType =
  | 'goal' | 'own_goal' | 'save' | 'shot_off' | 'corner' | 'offside' | 'foul'
  | 'yellow' | 'red' | 'double_yellow' | 'var'
  | 'halftime' | 'fulltime' | 'motm' | 'kickoff' | 'summary' | 'tension'

export interface MatchEvent {
  minute: number
  type: EventType
  playerName: string
  side: 'home' | 'away'
  text?: string
}

export interface MatchResult {
  myGoals: number
  rivalGoals: number
  events: MatchEvent[]
  myOverall: number
  rivalOverall: number
}

function lcg(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function avgOverall(players: Player[]): number {
  if (!players.length) return 70
  return players.reduce((sum, p) => sum + p.overall, 0) / players.length
}

function weightedPick(players: Player[], rand: () => number): string {
  const pool = players.filter(p => p.position !== 'ARQ')
  if (!pool.length) return players[0]?.name ?? '?'
  const weights = pool.map(p => p.goals + 1)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i].name
  }
  return pool[pool.length - 1].name
}

function randomPick(players: Player[], rand: () => number): string {
  return players[Math.floor(rand() * players.length)]?.name ?? '?'
}

function poissonSample(lambda: number, rand: () => number): number {
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rand() } while (p > L)
  return k - 1
}

// ── Adventure mode: segment-based interactive simulation ──────────────────

export interface DecisionOption {
  id: string
  label: string
  description: string
  attackMod: number
  defenseMod: number
}

export interface MatchDecision {
  minute: number
  context: string
  options: [DecisionOption, DecisionOption, DecisionOption]
}

export const ADVENTURE_DECISIONS: [MatchDecision, MatchDecision] = [
  {
    minute: 30,
    context: '¿Qué indicación dás en el descanso?',
    options: [
      { id: 'attack',   label: '⚡ Salir a ganar',          description: 'Presión alta, más líneas ofensivas', attackMod: 1.35, defenseMod: 0.80 },
      { id: 'balanced', label: '⚖️ Mantener el esquema',    description: 'Sin cambios tácticos',              attackMod: 1.08, defenseMod: 1.08 },
      { id: 'defend',   label: '🛡 Cerrar la defensa',      description: 'Línea baja, aguantar y contragolpear', attackMod: 0.80, defenseMod: 1.35 },
    ],
  },
  {
    minute: 65,
    context: '¿Qué cambio hacés en el minuto 65?',
    options: [
      { id: 'striker',  label: '🔄 Meter un 9 fresco',      description: 'Delantero de área al campo',        attackMod: 1.45, defenseMod: 0.82 },
      { id: 'mid',      label: '🔄 Cambio en el medio',     description: 'Más control y pressing',            attackMod: 1.12, defenseMod: 1.18 },
      { id: 'defender', label: '🔄 Reforzar atrás',         description: 'Cerrar la línea defensiva',         attackMod: 0.78, defenseMod: 1.48 },
    ],
  },
]

const SEGMENT_RANGES = [
  { from: 1,  to: 30 },
  { from: 31, to: 65 },
  { from: 66, to: 90 },
] as const

export function computeBaseXG(mySquad: Player[], rival: RivalTeam): { homeXG: number; awayXG: number } {
  const myAtk = avgOverall(mySquad.filter(p => p.position === 'DEL')) * 0.6 +
                avgOverall(mySquad.filter(p => p.position === 'MED')) * 0.4
  const myDef = avgOverall(mySquad.filter(p => p.position === 'DEF')) * 0.7 +
                avgOverall(mySquad.filter(p => p.position === 'ARQ')) * 0.3
  const rvAtk = avgOverall(rival.players.filter(p => p.position === 'DEL')) * 0.6 +
                avgOverall(rival.players.filter(p => p.position === 'MED')) * 0.4
  const rvDef = avgOverall(rival.players.filter(p => p.position === 'DEF')) * 0.7 +
                avgOverall(rival.players.filter(p => p.position === 'ARQ')) * 0.3
  return {
    homeXG: Math.max(0.3, Math.min(3.5, 1.5 + (myAtk - rvDef) / 80)),
    awayXG: Math.max(0.3, Math.min(3.5, 1.5 + (rvAtk - myDef) / 80)),
  }
}

export function simulateSegment(
  mySquad: Player[],
  rival: RivalTeam,
  seed: number,
  segmentIdx: 0 | 1 | 2,
  homeXG: number,
  awayXG: number,
  attackMod = 1,
  defenseMod = 1,
): { events: MatchEvent[]; myGoals: number; rivalGoals: number } {
  const { from, to } = SEGMENT_RANGES[segmentIdx]
  const duration = to - from + 1
  const fraction = duration / 90
  const rand = lcg(seed)

  const segHomeXG = homeXG * fraction * attackMod
  const segAwayXG = awayXG * fraction / defenseMod

  const myGoals    = poissonSample(Math.max(0.05, segHomeXG), rand)
  const rivalGoals = poissonSample(Math.max(0.05, segAwayXG), rand)

  const usedMinutes = new Set<number>()
  function pickMinute(): number {
    let m: number
    do { m = from + Math.floor(rand() * duration) } while (usedMinutes.has(m))
    usedMinutes.add(m)
    return m
  }

  const events: MatchEvent[] = []
  for (let i = 0; i < myGoals;    i++) events.push({ minute: pickMinute(), type: 'goal', playerName: weightedPick(mySquad,       rand), side: 'home' })
  for (let i = 0; i < rivalGoals; i++) events.push({ minute: pickMinute(), type: 'goal', playerName: weightedPick(rival.players, rand), side: 'away' })

  const extraCount = 1 + Math.floor(rand() * 3)
  const nonGoal: EventType[] = ['save', 'shot_off', 'corner', 'offside']
  for (let i = 0; i < extraCount; i++) {
    const side = rand() < 0.55 ? 'home' : 'away'
    const pool = side === 'home' ? mySquad : rival.players
    events.push({ minute: pickMinute(), type: nonGoal[Math.floor(rand() * nonGoal.length)], playerName: weightedPick(pool, rand), side })
  }
  if (rand() < 0.35) {
    const side = rand() < 0.5 ? 'home' : 'away'
    const pool = side === 'home' ? mySquad : rival.players
    events.push({ minute: pickMinute(), type: 'foul', playerName: randomPick(pool, rand), side })
  }

  events.sort((a, b) => a.minute - b.minute)
  return { events, myGoals, rivalGoals }
}

// ── Classic simulation (Sim mode) ─────────────────────────────────────────

export function simulateMatch(mySquad: Player[], rival: RivalTeam, seed: number): MatchResult {
  const rand = lcg(seed)

  const myOverall = Math.round(avgOverall(mySquad))
  const rivalOverall = Math.round(avgOverall(rival.players))

  const myAttack =
    avgOverall(mySquad.filter(p => p.position === 'DEL')) * 0.6 +
    avgOverall(mySquad.filter(p => p.position === 'MED')) * 0.4
  const myDefense =
    avgOverall(mySquad.filter(p => p.position === 'DEF')) * 0.7 +
    avgOverall(mySquad.filter(p => p.position === 'ARQ')) * 0.3

  const rivalAttack =
    avgOverall(rival.players.filter(p => p.position === 'DEL')) * 0.6 +
    avgOverall(rival.players.filter(p => p.position === 'MED')) * 0.4
  const rivalDefense =
    avgOverall(rival.players.filter(p => p.position === 'DEF')) * 0.7 +
    avgOverall(rival.players.filter(p => p.position === 'ARQ')) * 0.3

  const myXG = Math.max(0.3, Math.min(3.5, 1.5 + (myAttack - rivalDefense) / 80))
  const rivalXG = Math.max(0.3, Math.min(3.5, 1.5 + (rivalAttack - myDefense) / 80))

  const myGoals = poissonSample(myXG, rand)
  const rivalGoals = poissonSample(rivalXG, rand)

  const usedMinutes = new Set<number>()
  function pickMinute(): number {
    let m: number
    do { m = Math.floor(rand() * 90) + 1 } while (usedMinutes.has(m))
    usedMinutes.add(m)
    return m
  }

  const events: MatchEvent[] = []

  // Goals
  for (let i = 0; i < myGoals; i++) {
    events.push({ minute: pickMinute(), type: 'goal', playerName: weightedPick(mySquad, rand), side: 'home' })
  }
  for (let i = 0; i < rivalGoals; i++) {
    events.push({ minute: pickMinute(), type: 'goal', playerName: weightedPick(rival.players, rand), side: 'away' })
  }

  // Non-goal attacks for each team: 3-5 each
  const myExtraAttacks = 3 + Math.floor(rand() * 3)
  const rivalExtraAttacks = 3 + Math.floor(rand() * 3)
  const attackOutcomes: EventType[] = ['save', 'save', 'shot_off', 'shot_off', 'corner', 'offside']

  for (let i = 0; i < myExtraAttacks; i++) {
    const type = attackOutcomes[Math.floor(rand() * attackOutcomes.length)]
    events.push({ minute: pickMinute(), type, playerName: weightedPick(mySquad, rand), side: 'home' })
  }
  for (let i = 0; i < rivalExtraAttacks; i++) {
    const type = attackOutcomes[Math.floor(rand() * attackOutcomes.length)]
    events.push({ minute: pickMinute(), type, playerName: weightedPick(rival.players, rand), side: 'away' })
  }

  // Fouls: 2-3 total, mixed between both teams
  const foulCount = 2 + Math.floor(rand() * 2)
  for (let i = 0; i < foulCount; i++) {
    const side = rand() < 0.5 ? 'home' : 'away'
    const pool = side === 'home' ? mySquad : rival.players
    events.push({ minute: pickMinute(), type: 'foul', playerName: randomPick(pool, rand), side })
  }

  // Yellow cards: 1-2
  const yellowCount = 1 + Math.floor(rand() * 2)
  for (let i = 0; i < yellowCount; i++) {
    const side = rand() < 0.5 ? 'home' : 'away'
    const pool = side === 'home' ? mySquad : rival.players
    events.push({ minute: pickMinute(), type: 'yellow', playerName: randomPick(pool, rand), side })
  }

  events.sort((a, b) => a.minute - b.minute)

  return { myGoals, rivalGoals, events, myOverall, rivalOverall }
}

// ── Microservice integration ───────────────────────────────────────────────────

interface EngineEvent {
  side: 'home' | 'away'
  type: 'goal' | 'yellow_card' | 'red_card'
  player: string
  minute: number
}

interface EngineRepMatch {
  events: EngineEvent[]
  score_home: number
  score_away: number
}

interface NarrationEvent {
  minuto: number
  tipo: string
  texto: string
  side?: 'home' | 'away'
  player?: string
}

interface EngineResult {
  representative_match: EngineRepMatch | null
  avg_goals_home: number
  avg_goals_away: number
  narration: NarrationEvent[] | null
}

const POS_FOUL_BASELINE: Record<string, number> = { ARQ: 0.1, DEF: 0.9, MED: 1.1, DEL: 1.3 }

// Positional ceilings prevent absurd rates from players with small sample sizes.
const GOALS_PER_90_CAP: Record<string, number> = { ARQ: 0.02, DEF: 0.15, MED: 0.40, DEL: 0.65 }

function toEnginePlayer(p: Player) {
  const seasonMins = Math.max(p.minutes, 90)
  const goals90    = Math.min((p.goals   / seasonMins) * 90, GOALS_PER_90_CAP[p.position] ?? 0.65)
  const assists90  = (p.assists / seasonMins) * 90
  // Reverse-engineer fouls from yellow cards (LPF avg: 1 yellow ≈ 3.6 fouls)
  const fouls90 = p.yellowCards > 0
    ? Math.max((p.yellowCards / seasonMins) * 90 / 0.28, 0.1)
    : POS_FOUL_BASELINE[p.position] ?? 1.0
  // Map overall (60–100 typical) → match rating (6.0–8.0)
  const ratingMean = Math.max(5.5, Math.min(8.5, 6.0 + (p.overall - 65) / 35 * 2.0))

  return {
    id:                    null,
    name:                  p.name,
    position:              p.position,
    minutes:               90,
    goals_per_90_shrunk:   Math.max(goals90, 0.001),
    assists_per_90_shrunk: Math.max(assists90, 0.001),
    fouls_per_90:          fouls90,
    rating_mean:           ratingMean,
    rating_std:            0.6,
  }
}

const STRATEGY_MENTALITY: Record<string, string> = {
  balanced:  'equilibrada',
  offensive: 'ofensiva',
  defensive: 'defensiva',
  counter:   'contraataque',
}

export function warmUpEngine(): void {
  const url = (import.meta.env.VITE_SIM_ENGINE_URL as string | undefined)?.replace(/\/$/, '')
  if (!url) return
  fetch(`${url}/health`, { method: 'GET' }).catch(() => {})
}

export async function callSimEngine(mySquad: Player[], rival: RivalTeam, seed: number, strategy = 'balanced', formation?: string): Promise<MatchResult> {
  const url = (import.meta.env.VITE_SIM_ENGINE_URL as string | undefined)?.replace(/\/$/, '')
  if (!url) throw new Error('VITE_SIM_ENGINE_URL no configurada')

  const body = {
    home_team: 'Tu Equipo',
    away_team: rival.name,
    tactics_home: { formation: formation ?? null, mentality: STRATEGY_MENTALITY[strategy] ?? 'equilibrada', intensity: 'media' },
    tactics_away: { formation: rival.formation ?? null, mentality: 'equilibrada', intensity: 'media' },
    home: mySquad.map(toEnginePlayer),
    away: rival.players.map(toEnginePlayer),
    n_sims: 1,
    seed,
  }

  const res = await fetch(`${url}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Motor: ${res.status} ${await res.text()}`)

  const data = await res.json() as EngineResult
  const rep = data.representative_match

  const myGoals    = rep?.score_home ?? Math.round(data.avg_goals_home)
  const rivalGoals = rep?.score_away ?? Math.round(data.avg_goals_away)

  const TIPO_MAP: Record<string, EventType> = {
    gol:            'goal',
    gol_en_contra:  'own_goal',
    amarilla:       'yellow',
    roja:           'red',
    doble_amarilla: 'double_yellow',
    atajada:        'save',
    ocasion_errada: 'shot_off',
    corner:         'corner',
    offside:        'offside',
    var:            'var',
    entretiempo:    'halftime',
    pitazo_final:   'fulltime',
    figura:         'motm',
    arranque:       'kickoff',
    resumen:        'summary',
    tension:        'tension',
  }

  const events: MatchEvent[] = (data.narration ?? [])
    .filter(n => TIPO_MAP[n.tipo])
    .map(n => ({
      minute:     n.minuto,
      type:       TIPO_MAP[n.tipo],
      playerName: n.player ?? '',
      side:       n.side ?? 'home',
      text:       n.texto,
    }))

  return {
    myGoals,
    rivalGoals,
    events,
    myOverall:    Math.round(avgOverall(mySquad)),
    rivalOverall: Math.round(avgOverall(rival.players)),
  }
}

export async function callSimEngineSecondHalf(
  mySquad: Player[],
  rival: RivalTeam,
  seed: number,
  strategy: string,
  scoreHome: number,
  scoreAway: number,
  bookedHome: string[],
  bookedAway: string[],
  formation?: string,
  rivalStrategy?: string,
): Promise<MatchEvent[]> {
  const url = (import.meta.env.VITE_SIM_ENGINE_URL as string | undefined)?.replace(/\/$/, '')
  if (!url) throw new Error('VITE_SIM_ENGINE_URL no configurada')

  const body = {
    home_team: 'Tu Equipo',
    away_team: rival.name,
    tactics_home: { formation: formation ?? null, mentality: STRATEGY_MENTALITY[strategy] ?? 'equilibrada', intensity: 'media', captain_id: null },
    tactics_away: { formation: rival.formation ?? null, mentality: STRATEGY_MENTALITY[rivalStrategy ?? ''] ?? 'equilibrada', intensity: 'media', captain_id: null },
    home: mySquad.map(toEnginePlayer),
    away: rival.players.map(toEnginePlayer),
    n_sims: 1,
    seed,
    score_home: scoreHome,
    score_away: scoreAway,
    booked_home: bookedHome,
    booked_away: bookedAway,
  }

  const res = await fetch(`${url}/simulate-second-half`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Motor: ${res.status} ${await res.text()}`)

  const data = await res.json() as EngineResult

  const TIPO_MAP: Record<string, EventType> = {
    gol: 'goal', gol_en_contra: 'own_goal',
    amarilla: 'yellow', roja: 'red', doble_amarilla: 'double_yellow',
    atajada: 'save', ocasion_errada: 'shot_off',
    corner: 'corner', offside: 'offside', var: 'var',
    entretiempo: 'halftime', pitazo_final: 'fulltime', figura: 'motm',
    arranque: 'kickoff', resumen: 'summary', tension: 'tension',
  }

  return (data.narration ?? [])
    .filter(n => TIPO_MAP[n.tipo])
    .map(n => ({
      minute: n.minuto,
      type: TIPO_MAP[n.tipo],
      playerName: n.player ?? '',
      side: n.side ?? 'home',
      text: n.texto,
    }))
}
