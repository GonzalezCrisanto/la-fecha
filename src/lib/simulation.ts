import type { Player, RivalTeam } from '../types'

export interface MatchEvent {
  minute: number
  type: 'goal' | 'yellow' | 'save'
  playerName: string
  side: 'home' | 'away'
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

function poissonSample(lambda: number, rand: () => number): number {
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rand() } while (p > L)
  return k - 1
}

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

  for (let i = 0; i < myGoals; i++) {
    events.push({ minute: pickMinute(), type: 'goal', playerName: weightedPick(mySquad, rand), side: 'home' })
  }
  for (let i = 0; i < rivalGoals; i++) {
    events.push({ minute: pickMinute(), type: 'goal', playerName: weightedPick(rival.players, rand), side: 'away' })
  }

  const yellowCount = 2 + Math.floor(rand() * 3)
  for (let i = 0; i < yellowCount; i++) {
    const side = rand() < 0.5 ? 'home' : 'away'
    const pool = side === 'home' ? mySquad : rival.players
    events.push({
      minute: pickMinute(),
      type: 'yellow',
      playerName: pool[Math.floor(rand() * pool.length)].name,
      side,
    })
  }

  events.sort((a, b) => a.minute - b.minute)

  return { myGoals, rivalGoals, events, myOverall, rivalOverall }
}
