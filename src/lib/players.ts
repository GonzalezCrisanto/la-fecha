import type { Player, Position, DailyChallenge, Formation } from '../types'

export const TEAM_DISPLAY_NAMES: Record<string, string> = {
  'Arg Juniors':     'Argentinos Juniors',
  'Atlé Tucumán':   'Atlético Tucumán',
  'C. Córdoba–SdE': 'Central Córdoba',
  'CA San Lorenzo':  'San Lorenzo',
  'Defensa':         'Defensa y Justicia',
  'Estudiantes–LP':  'Estudiantes (LP)',
  'Estudiantes–RC':  'Estudiantes (RC)',
  'Gimnasia–LP':     'Gimnasia (LP)',
  'Gimnasia–M':      'Gimnasia (M)',
  'Ind. Rivadavia':  'Independiente Rivadavia',
  'Sarmiento–J':     'Sarmiento',
  'Talleres–C':      'Talleres',
}

export function teamDisplayName(raw: string): string {
  return TEAM_DISPLAY_NAMES[raw] ?? raw
}

let _cache: Player[] | null = null

export async function loadPlayers(): Promise<Player[]> {
  if (_cache) return _cache
  const res = await fetch('/data/players.json')
  _cache = await res.json()
  return _cache!
}

export function playersByPosition(players: Player[], pos: Position): Player[] {
  return players.filter(p => p.position === pos).sort((a, b) => b.overall - a.overall)
}

/** Deterministic daily rival — same for every user on the same date */
export function getDailyChallenge(players: Player[], dateStr?: string): DailyChallenge {
  const date = dateStr ?? new Date().toISOString().slice(0, 10)
  const seed = hashDate(date)

  const teams = [...new Set(players.map(p => p.team))]
  const rivalTeamName = teams[seed % teams.length]
  const rivalPlayers = buildRivalTeam(players, rivalTeamName, seed)

  return {
    date,
    rival: {
      name: rivalTeamName,
      players: rivalPlayers,
      formation: FORMATIONS[seed % FORMATIONS.length],
    },
    blockedPlayerIds: rivalPlayers.map(p => p.id),
  }
}

export const SQUAD_SLOTS: Record<Position, number> = {
  ARQ: 1,
  DEF: 4,
  MED: 3,
  DEL: 3,
}

export const BUDGET = 400

export const MAX_PER_CLUB = 3

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1']

export function getAdventureRivals(players: Player[], dateStr?: string): RivalTeam[] {
  const date = dateStr ?? new Date().toISOString().slice(0, 10)
  const seed = hashDate(date)
  const teams = [...new Set(players.map(p => p.team))]
  return [1, 2, 3].map(i => {
    const s = seed + i * 31
    const teamName = teams[s % teams.length]
    return {
      name: teamName,
      players: buildRivalTeam(players, teamName, s),
      formation: FORMATIONS[s % FORMATIONS.length],
    }
  })
}

function hashDate(date: string): number {
  return date.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
}

function buildRivalTeam(players: Player[], teamName: string, _seed: number): Player[] {
  const slots: Record<Position, number> = { ARQ: 1, DEF: 4, MED: 3, DEL: 3 }
  const result: Player[] = []
  for (const [pos, count] of Object.entries(slots) as [Position, number][]) {
    const pool = players.filter(p => p.team === teamName && p.position === pos)
    const picked = pool.sort((a, b) => b.overall - a.overall).slice(0, count)
    // fill with best available at that position if team doesn't have enough
    if (picked.length < count) {
      const fill = players
        .filter(p => p.position === pos && p.team !== teamName && !result.find(r => r.id === p.id))
        .sort((a, b) => b.overall - a.overall)
        .slice(0, count - picked.length)
      picked.push(...fill)
    }
    result.push(...picked)
  }
  return result.slice(0, 11)
}
