import type { Player } from '../types'

export type PenaltyZone = 'TL' | 'TC' | 'TR' | 'BL' | 'BC' | 'BR'
export type PenaltyOutcome = 'goal' | 'save' | 'miss' | 'post'

export interface KickRecord {
  side: 'home' | 'away'
  kicker: Player
  zone: PenaltyZone
  gkZone: PenaltyZone
  outcome: PenaltyOutcome
}

export const ZONES: PenaltyZone[] = ['TL', 'TC', 'TR', 'BL', 'BC', 'BR']

// Probability of missing by zone (top corners are risky)
const MISS_RATE: Record<PenaltyZone, number> = {
  TL: 0.12, TC: 0.04, TR: 0.12,
  BL: 0.06, BC: 0.03, BR: 0.06,
}

// GK base dive distribution (GKs tend to dive low corners)
const GK_BASE: Record<PenaltyZone, number> = {
  TL: 0.08, TC: 0.04, TR: 0.08,
  BL: 0.32, BC: 0.04, BR: 0.32,
}

function seededRng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedPick<T>(items: T[], weights: number[], rng: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

function zoneProximity(a: PenaltyZone, b: PenaltyZone): 'exact' | 'adjacent' | 'far' {
  if (a === b) return 'exact'
  const row = (z: PenaltyZone) => ZONES.indexOf(z) < 3 ? 0 : 1
  const col = (z: PenaltyZone) => ZONES.indexOf(z) % 3
  if (Math.abs(row(a) - row(b)) <= 1 && Math.abs(col(a) - col(b)) <= 1) return 'adjacent'
  return 'far'
}

export function shooterSkill(p: Player): number {
  const goalRate = p.minutes > 0 ? p.goals / p.minutes : 0
  return Math.min(0.90, Math.max(0.60, 0.70 + (p.overall - 70) / 120 + goalRate * 3))
}

export function gkSkill(gk: Player): number {
  return Math.min(0.42, Math.max(0.18, 0.28 + (gk.overall - 60) / 200))
}

export function gkPickZone(gk: Player, rng: () => number): PenaltyZone {
  const skill = gkSkill(gk)
  const weights = ZONES.map(z => Math.max(0.01, GK_BASE[z] * (1 + skill * 0.5)))
  return weightedPick(ZONES, weights, rng)
}

export function rivalPickZone(shooter: Player, rng: () => number): PenaltyZone {
  const skill = shooterSkill(shooter)
  const cornerBonus = Math.max(0, (skill - 0.70) * 2)
  const weights: Record<PenaltyZone, number> = {
    TL: 0.08 + cornerBonus * 0.4,
    TC: 0.06,
    TR: 0.08 + cornerBonus * 0.4,
    BL: 0.28 + cornerBonus * 0.3,
    BC: 0.04,
    BR: 0.28 + cornerBonus * 0.3,
  }
  return weightedPick(ZONES, ZONES.map(z => weights[z]), rng)
}

export function simulateKick(
  shooter: Player,
  gk: Player,
  zone: PenaltyZone,
  seed: number,
): { outcome: PenaltyOutcome; gkZone: PenaltyZone } {
  const rng = seededRng(seed)
  const skill = shooterSkill(shooter)
  const gkS = gkSkill(gk)

  const missChance = MISS_RATE[zone] * (1 - (skill - 0.70) * 1.5)
  if (rng() < missChance) {
    return { outcome: rng() < 0.35 ? 'post' : 'miss', gkZone: gkPickZone(gk, rng) }
  }

  const gkZone = gkPickZone(gk, rng)
  const prox = zoneProximity(zone, gkZone)
  const baseSave = prox === 'exact' ? 0.78 : prox === 'adjacent' ? 0.16 : 0.04
  const saveChance = baseSave * (1 + (gkS - 0.28) * 1.5) * (1 - (skill - 0.70) * 0.5)

  if (rng() < saveChance) return { outcome: 'save', gkZone }
  return { outcome: 'goal', gkZone }
}

export function simulateRivalKick(
  shooter: Player,
  gk: Player,
  seed: number,
): { zone: PenaltyZone; gkZone: PenaltyZone; outcome: PenaltyOutcome } {
  const rng = seededRng(seed)
  const zone = rivalPickZone(shooter, rng)
  const { outcome, gkZone } = simulateKick(shooter, gk, zone, seed + 10_000)
  return { zone, gkZone, outcome }
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = seededRng(seed)
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function autoSelectRivalKickers(players: Player[]): Player[] {
  const priority: Record<string, number> = { DEL: 0, MED: 1, DEF: 2, ARQ: 3 }
  return [...players]
    .sort((a, b) => {
      const pd = (priority[a.position] ?? 4) - (priority[b.position] ?? 4)
      return pd !== 0 ? pd : b.overall - a.overall
    })
    .slice(0, 5)
}

export function getGK(players: Player[]): Player {
  return players.find(p => p.position === 'ARQ') ?? players[0]
}

export function getKicker(
  side: 'home' | 'away',
  kickNumber: number,
  selectedOrder: Player[],
  allPlayers: Player[],
  seed: number,
): Player {
  if (kickNumber < selectedOrder.length) return selectedOrder[kickNumber]

  const remaining = seededShuffle(
    allPlayers.filter(p => !selectedOrder.some(o => o.id === p.id)),
    seed + (side === 'home' ? 1 : 2),
  )

  const remainIdx = kickNumber - selectedOrder.length
  if (remainIdx < remaining.length) return remaining[remainIdx]

  const cycleIdx = (kickNumber - selectedOrder.length - remaining.length) % selectedOrder.length
  return selectedOrder[cycleIdx]
}

export function getShootoutStatus(kicks: KickRecord[]): 'ongoing' | 'home' | 'away' {
  const hk = kicks.filter(k => k.side === 'home')
  const ak = kicks.filter(k => k.side === 'away')
  const hs = hk.filter(k => k.outcome === 'goal').length
  const as_ = ak.filter(k => k.outcome === 'goal').length
  const hc = hk.length
  const ac = ak.length

  if (hc < 5 || ac < 5) {
    const hr = Math.max(0, 5 - hc)
    const ar = Math.max(0, 5 - ac)
    if (hs + hr < as_) return 'away'
    if (as_ + ar < hs) return 'home'
    return 'ongoing'
  }

  // After each complete regulation/SD round (both kicked same count): check result
  if (hc === ac) {
    if (hs > as_) return 'home'
    if (as_ > hs) return 'away'
  }

  return 'ongoing'
}
