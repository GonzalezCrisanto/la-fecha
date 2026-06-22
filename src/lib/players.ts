import type { Player, Position, DailyChallenge, Formation, RivalTeam } from '../types'

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
  const rivalFormation = FORMATIONS[seed % FORMATIONS.length]
  const rivalPlayers = buildRivalTeam(players, rivalTeamName, rivalFormation)

  return {
    date,
    rival: { name: rivalTeamName, players: rivalPlayers, formation: rivalFormation },
    blockedPlayerIds: rivalPlayers.map(p => p.id),
  }
}

export const FORMATION_SLOTS: Record<Formation, Record<Position, number>> = {
  '4-3-3':   { ARQ: 1, DEF: 4, MED: 3, DEL: 3 },
  '4-4-2':   { ARQ: 1, DEF: 4, MED: 4, DEL: 2 },
  '3-5-2':   { ARQ: 1, DEF: 3, MED: 5, DEL: 2 },
  '4-2-3-1': { ARQ: 1, DEF: 4, MED: 5, DEL: 1 },
  '3-4-3':   { ARQ: 1, DEF: 3, MED: 4, DEL: 3 },
  '5-3-2':   { ARQ: 1, DEF: 5, MED: 3, DEL: 2 },
}

export const BUDGET = 300

export const MAX_PER_CLUB = 3

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1']

export function getAdventureRivals(players: Player[], dateStr?: string): RivalTeam[] {
  const date = dateStr ?? new Date().toISOString().slice(0, 10)
  const seed = hashDate(date)
  const teams = [...new Set(players.map(p => p.team))]
  const used = new Set<string>()
  return [1, 2, 3].map(i => {
    const s = (seed + i * 31) >>> 0
    // Skip teams already picked to guarantee 3 distinct rivals
    let idx = s % teams.length
    while (used.has(teams[idx])) idx = (idx + 1) % teams.length
    const teamName = teams[idx]
    used.add(teamName)
    const formation = FORMATIONS[s % FORMATIONS.length]
    return {
      name: teamName,
      players: buildRivalTeam(players, teamName, formation),
      formation,
    }
  })
}

function hashDate(date: string): number {
  // Positional hash (djb2-style) — avoids anagram collisions like '2026-06-20' vs '2026-06-02'
  return date.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 17)
}

function buildRivalTeam(players: Player[], teamName: string, formation: Formation): Player[] {
  const slots = FORMATION_SLOTS[formation]
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
