// src/lib/adventure.ts
// Self-contained adventure mode: engine (ported from adventure-engine.ts),
// Gemini narration (ported from adventure-narrator.ts), and match utilities.
// No filesystem, no Supabase — all runs in the browser.

import type { Player } from '../types'
import { teamDisplayName } from './players'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Pos = 'ARQ' | 'DEF' | 'MED' | 'DEL'

export type ActionType =
  | 'shoot' | 'long_shot' | 'through_ball' | 'cross'
  | 'dribble' | 'hold_play'
  | 'tackle' | 'hold_position' | 'tactical_foul' | 'clear'

export type ActionResult =
  | 'goal' | 'saved' | 'off_target' | 'blocked'
  | 'possession_lost' | 'cleared' | 'danger_stopped'
  | 'chance_created' | 'foul_won'
  | 'penalty' | 'penalty_missed'
  | 'yellow_card' | 'red_card'

export type SituationType = 'attack' | 'defense'
export type DefensiveSubType = 'dribbler' | 'aerial' | 'loose_ball'

export type GameStrategy = 'balanced' | 'offensive' | 'defensive' | 'counter'

export interface StrategyConfig {
  label: string
  pros: string[]
  cons: string[]
  attackProbDelta: number
  homeGoalMult: number
  awayGoalMult: number
  xgMult: number
  defBonus: number
}

export const STRATEGIES: Record<GameStrategy, StrategyConfig> = {
  balanced: {
    label: 'Equilibrado',
    pros: ['⚖️ Balance perfecto entre ataque y defensa'],
    cons: [],
    attackProbDelta: 0, homeGoalMult: 1.0, awayGoalMult: 1.0, xgMult: 1.0, defBonus: 0,
  },
  offensive: {
    label: 'Ofensivo',
    pros: ['⚔️ +25% peligro ofensivo'],
    cons: ['🛡️ +15% exposición al contragolpe'],
    attackProbDelta: 0.15, homeGoalMult: 1.20, awayGoalMult: 1.12, xgMult: 1.25, defBonus: -0.08,
  },
  defensive: {
    label: 'Defensivo',
    pros: ['🛡️ +20% solidez defensiva'],
    cons: ['⚔️ -15% producción ofensiva'],
    attackProbDelta: -0.15, homeGoalMult: 0.85, awayGoalMult: 0.78, xgMult: 0.88, defBonus: 0.18,
  },
  counter: {
    label: 'Contraataque',
    pros: ['⚡ +30% efectividad al contragolpe'],
    cons: ['📉 -25% situaciones de ataque'],
    attackProbDelta: -0.22, homeGoalMult: 1.05, awayGoalMult: 0.72, xgMult: 1.35, defBonus: 0.10,
  },
}

export interface ActionRates {
  xg_per90: number
  xg_per_shot: number
  ontarget_rate: number
  finish_rate: number
  keypass_per90: number
  xa_per90: number
  aerial_win_rate: number
  tackle_win_rate: number
  clearance_per90: number
  duel_win_rate: number
  goals_prevented_per90: number | null
  saved_inside_box_per90: number | null
}

export interface ActionInput {
  action: ActionType
  actor: Player
  target: Player | null
  keeper: Player | null
  defender: Player | null
  minute: number
}

export interface ActionOutcome {
  action: ActionType
  result: ActionResult
  scorer: Player | null
  assister: Player | null
  cardOn: Player | null
  xg: number
  detail: string
  opponentGoal?: boolean
  concededScorer?: Player | null
  secondaryGoal?: boolean
}

export interface DecisionPoint {
  minute: number
  situationType: SituationType
  attackingSide: 'home' | 'away'
  primary: Player
  supporting: Player[]
  keeper: Player | null
  defender: Player | null
  candidateActions: ActionType[]
  ballCarrierPosition: Pos
  defensiveSubType?: DefensiveSubType
}

export interface NarratedOption {
  action: ActionType
  label: string
}

export interface NarratedDecision {
  narration: string
  situation: string
  options: NarratedOption[]
}

export interface NarratedOutcome {
  text: string
}

export interface MatchLogEntry {
  minute: number
  kind: 'background' | 'outcome'
  text: string
}

export interface MatchState {
  minute: number
  scoreHome: number
  scoreAway: number
  redCardsHome: number
  redCardsAway: number
  userSide: 'home'
  possession: 'home' | 'away'
  lastOutcomeType: string | null
  log: MatchLogEntry[]
}

export const TOTAL_DECISIONS = 6

// ── Calibration constants (from adventure-gameplay-v3) ───────────────────────

const K = {
  BASE_GOAL_BLEND:            0.15,
  KEEPER_WEIGHT:              0.30,
  LONG_SHOT_GOAL_PENALTY:     0.40,
  LONG_SHOT_ONTARGET_PENALTY: 0.65,
  LONG_SHOT_BLOCK_RATE:       0.12,
  THROUGH_BALL_XA_SCALE:      2.5,
  THROUGH_BALL_KP_SCALE:      0.10,
  THROUGH_BALL_XG_BONUS:      1.30,
  CROSS_CONNECT_SCALE:        0.25,
  CROSS_XG:                   0.12,
  DRIBBLE_DEF_SCALE:          0.35,
  HOLD_PLAY_FOUL_PROB:        0.25,
  HOLD_PLAY_CHANCE_PROB:      0.05,
  TACKLE_PENALTY_RATE:        0.08,
  HOLD_POS_BASE:              0.25,
  HOLD_POS_DUEL_SCALE:        0.50,
  TACTICAL_FOUL_RED_PROB:     0.12,
  CLEAR_CLEARANCE_SCALE:      0.12,
  CLEAR_AERIAL_SCALE:         0.50,
  CLEAR_MAX:                  0.92,
  BACKGROUND_SHARE:           0.75,
} as const

// ── Position priors ──────────────────────────────────────────────────────────

const PRIORS: Record<Pos, ActionRates> = {
  ARQ: {
    xg_per90: 0.002, xg_per_shot: 0.03, ontarget_rate: 0.20, finish_rate: 0.03,
    keypass_per90: 0.20, xa_per90: 0.05,
    aerial_win_rate: 0.60, tackle_win_rate: 0.50,
    clearance_per90: 0.80, duel_win_rate: 0.50,
    goals_prevented_per90: 0.20, saved_inside_box_per90: 2.20,
  },
  DEF: {
    xg_per90: 0.03, xg_per_shot: 0.06, ontarget_rate: 0.35, finish_rate: 0.06,
    keypass_per90: 0.30, xa_per90: 0.04,
    aerial_win_rate: 0.58, tackle_win_rate: 0.62,
    clearance_per90: 4.90, duel_win_rate: 0.56,
    goals_prevented_per90: null, saved_inside_box_per90: null,
  },
  MED: {
    xg_per90: 0.08, xg_per_shot: 0.07, ontarget_rate: 0.38, finish_rate: 0.09,
    keypass_per90: 0.80, xa_per90: 0.22,
    aerial_win_rate: 0.44, tackle_win_rate: 0.55,
    clearance_per90: 1.00, duel_win_rate: 0.50,
    goals_prevented_per90: null, saved_inside_box_per90: null,
  },
  DEL: {
    xg_per90: 0.35, xg_per_shot: 0.12, ontarget_rate: 0.42, finish_rate: 0.13,
    keypass_per90: 0.60, xa_per90: 0.20,
    aerial_win_rate: 0.48, tackle_win_rate: 0.42,
    clearance_per90: 0.40, duel_win_rate: 0.46,
    goals_prevented_per90: null, saved_inside_box_per90: null,
  },
}

const POSITION_GOALS_P90: Record<Pos, number> = {
  ARQ: 0.005, DEF: 0.04, MED: 0.09, DEL: 0.38,
}

// ── Player → ActionRates ─────────────────────────────────────────────────────

function playerToRates(p: Player): ActionRates {
  const prior = PRIORS[p.position]
  const mins  = Math.max(p.minutes, 1)
  const goalsP90   = (p.goals   / mins) * 90
  const assistsP90 = (p.assists / mins) * 90

  // overall influences all rates: pivot at 70, ±30% swing at the extremes
  const overallMod = clamp(1 + (p.overall - 70) / 100, 0.70, 1.30)

  const finishScale = p.appearances > 3
    ? clamp(goalsP90 / Math.max(prior.xg_per90, 0.03), 0.5, 2.0)
    : 1.0

  let gpP90 = prior.goals_prevented_per90
  if (p.position === 'ARQ' && p.appearances > 3) {
    const csRate = p.cleanSheets / p.appearances
    gpP90 = clamp(csRate * 0.5 * overallMod, 0.05, 0.8)
  }

  return {
    ...prior,
    xg_per90:      clamp(prior.xg_per90    * finishScale * overallMod, 0.01, 1.0),
    xg_per_shot:   clamp(prior.xg_per_shot * finishScale * overallMod, 0.02, 0.35),
    finish_rate:   clamp(prior.finish_rate  * finishScale * overallMod, 0.02, 0.35),
    ontarget_rate: clamp(prior.ontarget_rate * overallMod, 0.10, 0.75),
    keypass_per90: p.position !== 'ARQ'
      ? clamp(prior.keypass_per90 * (1 + assistsP90 * 2) * overallMod, 0.1, 3.0)
      : prior.keypass_per90,
    xa_per90: p.position !== 'ARQ'
      ? clamp(assistsP90 * 0.7 * overallMod, 0.01, 1.5)
      : prior.xa_per90,
    tackle_win_rate:  clamp(prior.tackle_win_rate  * overallMod, 0.20, 0.90),
    duel_win_rate:    clamp(prior.duel_win_rate    * overallMod, 0.20, 0.90),
    aerial_win_rate:  clamp(prior.aerial_win_rate  * overallMod, 0.20, 0.90),
    clearance_per90:  clamp(prior.clearance_per90  * overallMod, 0.10, 8.0),
    goals_prevented_per90: gpP90,
  }
}

function getGoalsRate(p: Player): number {
  const mins = Math.max(p.minutes, 1)
  const raw  = (p.goals / mins) * 90
  const prior = POSITION_GOALS_P90[p.position]
  const w = Math.min(p.appearances / (p.appearances + 5), 1)
  return w * raw + (1 - w) * prior
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= Math.random() } while (p > L)
  return k - 1
}

function weightedPickIdx(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return Math.floor(Math.random() * weights.length)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

function statModifier(statValue: number, pivot: number): number {
  return clamp(1 + (statValue - pivot) * 0.8, 0.6, 1.4)
}

function keeperSaveRate(k: ActionRates | null): number {
  if (!k) return 0.25
  const gp  = k.goals_prevented_per90  ?? 0
  const sib = k.saved_inside_box_per90 ?? 0
  return clamp(0.30 + gp * K.KEEPER_WEIGHT + Math.min(sib, 4) * 0.01, 0.05, 0.60)
}

// ── Possession tracking ───────────────────────────────────────────────────────

export function possessionAfterOutcome(
  result: ActionResult,
  attackerSide: 'home' | 'away',
  defenderSide: 'home' | 'away',
): 'home' | 'away' {
  switch (result) {
    case 'goal': case 'saved': case 'off_target': case 'blocked':
    case 'possession_lost': case 'cleared': case 'danger_stopped':
      return defenderSide
    default:
      return attackerSide
  }
}

// ── Secondary shot ────────────────────────────────────────────────────────────

export function resolveSecondaryShot(
  attacker: Player,
  keeper: Player | null,
  xg: number,
): { goal: boolean } {
  const aProf = playerToRates(attacker)
  const kProf = keeper ? playerToRates(keeper) : null
  const finishMod = clamp(0.6 + aProf.finish_rate, 0.6, 1.4)
  const rawXg     = clamp(xg * finishMod, 0.02, 0.95)
  const goalProb  = clamp(rawXg * (1 - keeperSaveRate(kProf)), 0.01, 0.92)
  return { goal: Math.random() < goalProb }
}

// ── Sub-resolvers ─────────────────────────────────────────────────────────────

function resolveShoot(input: ActionInput, actor: ActionRates, keeper: ActionRates | null, longShot: boolean, xgMult = 1): ActionOutcome {
  const base       = clamp(K.BASE_GOAL_BLEND * actor.xg_per_shot + (1 - K.BASE_GOAL_BLEND) * actor.finish_rate, 0, 1)
  const keeperAdj  = clamp(1 - K.KEEPER_WEIGHT * (keeper?.goals_prevented_per90 ?? 0), 0.5, 1.5)
  const ontarget   = longShot ? actor.ontarget_rate * K.LONG_SHOT_ONTARGET_PENALTY : actor.ontarget_rate
  const goalMult   = longShot ? K.LONG_SHOT_GOAL_PENALTY : 1
  const blended    = clamp(base * statModifier(actor.finish_rate, 0.12), 0, 1)
  const goalProb   = clamp(blended * goalMult * keeperAdj * xgMult, 0, ontarget)
  const r = Math.random()
  let result: ActionResult
  if (r < goalProb)         result = 'goal'
  else if (r < ontarget)    result = 'saved'
  else if (longShot && r < ontarget + K.LONG_SHOT_BLOCK_RATE) result = 'blocked'
  else                      result = 'off_target'
  return {
    action: input.action, result,
    scorer:   result === 'goal' ? input.actor : null,
    assister: null, cardOn: null,
    xg: actor.xg_per_shot * goalMult,
    detail: `${input.action} → ${result} (xg=${(actor.xg_per_shot * goalMult).toFixed(3)})`,
  }
}

function resolveThroughBall(input: ActionInput, actor: ActionRates, target: ActionRates): ActionOutcome {
  const baseProb   = actor.xa_per90 * K.THROUGH_BALL_XA_SCALE + actor.keypass_per90 * K.THROUGH_BALL_KP_SCALE
  const successProb = clamp(baseProb * statModifier(actor.xa_per90, 0.20), 0.05, 0.75)
  if (Math.random() < successProb) {
    const xgVal = target.xg_per_shot * K.THROUGH_BALL_XG_BONUS
    return { action: input.action, result: 'chance_created', scorer: null, assister: input.actor, cardOn: null, xg: xgVal, detail: `through_ball → chance_created` }
  }
  return { action: input.action, result: 'possession_lost', scorer: null, assister: null, cardOn: null, xg: 0, detail: 'through_ball → possession_lost' }
}

function resolveCross(input: ActionInput, actor: ActionRates, target: ActionRates): ActionOutcome {
  const connectProb = clamp(actor.keypass_per90 * K.CROSS_CONNECT_SCALE * target.aerial_win_rate * statModifier(target.aerial_win_rate, 0.50), 0, 0.70)
  if (Math.random() < connectProb) {
    return { action: input.action, result: 'chance_created', scorer: null, assister: input.actor, cardOn: null, xg: K.CROSS_XG, detail: 'cross → chance_created' }
  }
  return { action: input.action, result: 'cleared', scorer: null, assister: null, cardOn: null, xg: 0, detail: 'cross → cleared' }
}

function resolveDribble(input: ActionInput, actor: ActionRates, defender: ActionRates | null): ActionOutcome {
  const defStrength = defender ? defender.tackle_win_rate * 0.6 + defender.duel_win_rate * 0.4 : 0
  const successProb = clamp((actor.duel_win_rate - K.DRIBBLE_DEF_SCALE * defStrength) * statModifier(actor.duel_win_rate, 0.50), 0.05, 0.90)
  if (Math.random() < successProb) {
    return { action: input.action, result: 'chance_created', scorer: null, assister: null, cardOn: null, xg: actor.xg_per_shot, detail: 'dribble → chance_created' }
  }
  return { action: input.action, result: 'possession_lost', scorer: null, assister: null, cardOn: null, xg: 0, detail: 'dribble → possession_lost' }
}

function resolveHoldPlay(input: ActionInput): ActionOutcome {
  const r = Math.random()
  const result: ActionResult = r < K.HOLD_PLAY_FOUL_PROB ? 'foul_won' : r < K.HOLD_PLAY_FOUL_PROB + K.HOLD_PLAY_CHANCE_PROB ? 'chance_created' : 'danger_stopped'
  return { action: input.action, result, scorer: null, assister: null, cardOn: null, xg: result === 'chance_created' ? 0.04 : 0, detail: `hold_play → ${result}` }
}

function resolveTackle(input: ActionInput, actor: ActionRates, defBonus = 0): ActionOutcome {
  const winRate = clamp((actor.tackle_win_rate + defBonus) * statModifier(actor.tackle_win_rate, 0.55), 0.05, 0.92)
  if (Math.random() < winRate) {
    return { action: input.action, result: 'danger_stopped', scorer: null, assister: null, cardOn: null, xg: 0, detail: 'tackle → danger_stopped' }
  }
  const result: ActionResult = Math.random() < K.TACKLE_PENALTY_RATE ? 'penalty' : 'possession_lost'
  return { action: input.action, result, scorer: null, assister: null, cardOn: null, xg: 0, detail: `tackle → ${result}` }
}

function resolveHoldPosition(input: ActionInput, actor: ActionRates, defBonus = 0): ActionOutcome {
  const successProb = clamp((K.HOLD_POS_BASE + actor.duel_win_rate * K.HOLD_POS_DUEL_SCALE + defBonus) * statModifier(actor.duel_win_rate, 0.50), 0, 0.85)
  const result: ActionResult = Math.random() < successProb ? 'danger_stopped' : 'possession_lost'
  return { action: input.action, result, scorer: null, assister: null, cardOn: null, xg: 0, detail: `hold_position → ${result}` }
}

function resolveTacticalFoul(input: ActionInput): ActionOutcome {
  const result: ActionResult = Math.random() < K.TACTICAL_FOUL_RED_PROB ? 'red_card' : 'yellow_card'
  return { action: input.action, result, scorer: null, assister: null, cardOn: input.actor, xg: 0, detail: `tactical_foul → ${result}` }
}

function resolveClear(input: ActionInput, actor: ActionRates, defBonus = 0): ActionOutcome {
  const successProb = clamp(
    (actor.clearance_per90 * K.CLEAR_CLEARANCE_SCALE + actor.aerial_win_rate * K.CLEAR_AERIAL_SCALE + defBonus)
    * statModifier(actor.clearance_per90 * K.CLEAR_CLEARANCE_SCALE, 0.40),
    0, K.CLEAR_MAX,
  )
  const result: ActionResult = Math.random() < successProb ? 'cleared' : 'chance_created'
  return { action: input.action, result, scorer: null, assister: null, cardOn: null, xg: result === 'chance_created' ? K.CROSS_XG : 0, detail: `clear → ${result}` }
}

// ── resolveAction ─────────────────────────────────────────────────────────────

export function resolveAction(input: ActionInput, strategy: GameStrategy = 'balanced'): ActionOutcome {
  const cfg      = STRATEGIES[strategy]
  const actor    = playerToRates(input.actor)
  const keeper   = input.keeper   ? playerToRates(input.keeper)   : null
  const defender = input.defender ? playerToRates(input.defender) : null
  const target   = input.target   ? playerToRates(input.target)   : PRIORS['DEL']

  switch (input.action) {
    case 'shoot':          return resolveShoot(input, actor, keeper, false, cfg.xgMult)
    case 'long_shot':      return resolveShoot(input, actor, keeper, true, cfg.xgMult)
    case 'through_ball':   return resolveThroughBall(input, actor, target)
    case 'cross':          return resolveCross(input, actor, target)
    case 'dribble':        return resolveDribble(input, actor, defender)
    case 'hold_play':      return resolveHoldPlay(input)
    case 'tackle':         return resolveTackle(input, actor, cfg.defBonus)
    case 'hold_position':  return resolveHoldPosition(input, actor, cfg.defBonus)
    case 'tactical_foul':  return resolveTacticalFoul(input)
    case 'clear':          return resolveClear(input, actor, cfg.defBonus)
  }
}

// ── buildActionInput ──────────────────────────────────────────────────────────

export function buildActionInput(dp: DecisionPoint, action: ActionType): ActionInput {
  const isDefense = dp.situationType === 'defense'
  return {
    action,
    actor:    isDefense ? (dp.defender ?? dp.primary) : dp.primary,
    target:   isDefense ? null : (dp.supporting[0] ?? null),
    keeper:   dp.keeper,
    defender: isDefense ? dp.primary : null,
    minute:   dp.minute,
  }
}

// ── applyOutcome ──────────────────────────────────────────────────────────────

export function applyOutcome(
  state: MatchState,
  dp: DecisionPoint,
  outcome: ActionOutcome,
  lineupHome: Player[],
  _lineupAway: Player[],
): void {
  const attackerSide = dp.attackingSide
  const defenderSide: 'home' | 'away' = attackerSide === 'home' ? 'away' : 'home'

  if (outcome.result === 'goal' && outcome.scorer) {
    if (attackerSide === 'home') state.scoreHome++
    else state.scoreAway++
    state.log.push({ minute: state.minute, kind: 'outcome', text: `¡GOL de ${outcome.scorer.name}! ${state.scoreHome}-${state.scoreAway}` })
    state.possession = defenderSide
    state.lastOutcomeType = 'goal'
    return
  }

  if (outcome.opponentGoal) {
    if (state.userSide === 'home') state.scoreAway++
    else state.scoreHome++
    const scorer = outcome.concededScorer?.name ?? 'delantero rival'
    state.log.push({ minute: state.minute, kind: 'outcome', text: `¡GOL del rival! ${scorer} convierte. ${state.scoreHome}-${state.scoreAway}` })
    state.possession = state.userSide
    state.lastOutcomeType = outcome.result
    return
  }

  if ((outcome.result === 'red_card' || outcome.result === 'yellow_card') && outcome.cardOn) {
    const inHome = lineupHome.some(p => p.id === outcome.cardOn!.id)
    if (outcome.result === 'red_card') {
      if (inHome) state.redCardsHome++; else state.redCardsAway++
    }
  }

  state.log.push({ minute: state.minute, kind: 'outcome', text: outcome.detail })
  state.possession     = possessionAfterOutcome(outcome.result, attackerSide, defenderSide)
  state.lastOutcomeType = outcome.result
}

// ── Candidate actions ─────────────────────────────────────────────────────────

function getCandidateActions(situationType: SituationType, pos: Pos, minute: number, scoreDiff: number, defensiveSubType?: DefensiveSubType): ActionType[] {
  if (situationType === 'defense') {
    switch (defensiveSubType) {
      case 'dribbler':   return ['tackle', 'hold_position', 'tactical_foul']
      case 'aerial':     return ['clear', 'tackle', 'hold_position']
      case 'loose_ball': return ['tackle', 'clear', 'hold_position', 'tactical_foul']
      default:           return ['tackle', 'hold_position', 'tactical_foul']
    }
  }
  const lateAndLosing = minute >= 75 && scoreDiff < 0
  switch (pos) {
    case 'DEL': return ['shoot', 'long_shot', 'dribble', 'through_ball']
    case 'MED': return lateAndLosing ? ['through_ball', 'cross', 'dribble', 'long_shot'] : ['through_ball', 'cross', 'dribble']
    case 'DEF': return lateAndLosing ? ['through_ball', 'cross', 'hold_play', 'long_shot'] : ['through_ball', 'cross', 'hold_play']
    case 'ARQ': return ['hold_play', 'through_ball']
    default:    return ['hold_play']
  }
}

// ── generateDecisionPoint ─────────────────────────────────────────────────────

const DEFENSIVE_SUB_WEIGHTS: [DefensiveSubType, number][] = [
  ['dribbler',   5],
  ['aerial',     3],
  ['loose_ball', 2],
]

function pickDefensiveSubType(): DefensiveSubType {
  const total = DEFENSIVE_SUB_WEIGHTS.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [type, weight] of DEFENSIVE_SUB_WEIGHTS) {
    r -= weight
    if (r <= 0) return type
  }
  return 'dribbler'
}

export function generateDecisionPoint(
  state: MatchState,
  lineupHome: Player[],
  lineupAway: Player[],
  recentPrimaryIds: string[] = [],
  recentDefenderIds: string[] = [],
  strategy: GameStrategy = 'balanced',
): DecisionPoint {
  const userScore = state.scoreHome
  const oppScore  = state.scoreAway
  const scoreDiff = userScore - oppScore

  const LOSS_OUTCOMES = new Set(['possession_lost', 'saved', 'off_target', 'cleared', 'blocked'])
  const GAIN_OUTCOMES = new Set(['danger_stopped', 'foul_won'])
  const baseNeutral   = clamp(0.65 - scoreDiff * 0.05 + STRATEGIES[strategy].attackProbDelta, 0.25, 0.90)

  const last = state.lastOutcomeType
  const poss = state.possession
  let attackProb: number
  if (last && poss) {
    if (poss !== state.userSide && LOSS_OUTCOMES.has(last)) attackProb = 0.15 + Math.random() * 0.05
    else if (poss === state.userSide && GAIN_OUTCOMES.has(last)) attackProb = 0.80 + Math.random() * 0.05
    else attackProb = baseNeutral
  } else {
    attackProb = baseNeutral
  }

  const situationType: SituationType = Math.random() < attackProb ? 'attack' : 'defense'
  const attackingSide: 'home' | 'away' = situationType === 'attack' ? state.userSide : 'away'
  const attackingLineup = attackingSide === 'home' ? lineupHome : lineupAway
  const defendingLineup = attackingSide === 'home' ? lineupAway : lineupHome

  const primaryPool = attackingLineup.filter(p => p.position !== 'ARQ')
  const pool        = primaryPool.length > 0 ? primaryPool : attackingLineup

  const primaryWeights = pool.map(p => {
    const ap  = playerToRates(p)
    const base = Math.sqrt(Math.max(0, ap.xg_per90 + ap.xg_per_shot * 0.5))
    return recentPrimaryIds.includes(p.id) ? base * 0.10 : base
  })
  const primaryIdx = weightedPickIdx(primaryWeights)
  const primary    = pool[primaryIdx]

  const supportPool = pool.filter((_, i) => i !== primaryIdx)
  const sw  = supportPool.map(p => { const ap = playerToRates(p); return Math.sqrt(Math.max(0, ap.xg_per90 + ap.keypass_per90 + ap.aerial_win_rate)) })
  const s1  = supportPool[weightedPickIdx(sw)]
  const rem = supportPool.filter(p => p.id !== s1?.id)
  const s2  = rem.length > 0 ? rem[Math.floor(Math.random() * rem.length)] : null
  const supporting = [s1, s2].filter((p): p is Player => p !== null && p !== undefined)

  const keeper: Player | null = defendingLineup.find(p => p.position === 'ARQ') ?? null

  const defensiveSubType: DefensiveSubType | undefined =
    situationType === 'defense' ? pickDefensiveSubType() : undefined

  let defender: Player | null = null
  if (situationType === 'defense') {
    const defPool = lineupHome.filter(p => p.position === 'DEF' || p.position === 'MED')
    if (defPool.length > 0) {
      const dw = defPool.map(p => {
        const ap   = playerToRates(p)
        const base = ap.tackle_win_rate + ap.clearance_per90 * 0.2
        return recentDefenderIds.includes(p.id) ? base * 0.10 : base
      })
      defender = defPool[weightedPickIdx(dw)]
    }
  }

  return {
    minute: state.minute,
    situationType,
    attackingSide,
    primary,
    supporting,
    keeper,
    defender,
    candidateActions: getCandidateActions(situationType, primary.position, state.minute, scoreDiff, defensiveSubType),
    ballCarrierPosition: primary.position,
    defensiveSubType,
  }
}

// ── advanceInterval ───────────────────────────────────────────────────────────

const HOME_FACTOR = 1.05
const AWAY_FACTOR = 0.95

export function advanceInterval(
  state: MatchState,
  toMinute: number,
  lineupHome: Player[],
  lineupAway: Player[],
  strategy: GameStrategy = 'balanced',
): void {
  if (toMinute <= state.minute) { state.minute = toMinute; return }

  const cfg      = STRATEGIES[strategy]
  const interval = toMinute - state.minute
  const homeLambda = lineupHome.reduce((s, p) => s + getGoalsRate(p), 0) * HOME_FACTOR * cfg.homeGoalMult * (interval / 90) * K.BACKGROUND_SHARE
  const awayLambda = lineupAway.reduce((s, p) => s + getGoalsRate(p), 0) * AWAY_FACTOR * cfg.awayGoalMult * (interval / 90) * K.BACKGROUND_SHARE

  const homeGoals = poissonSample(homeLambda)
  const awayGoals = poissonSample(awayLambda)

  const hw = lineupHome.map(p => getGoalsRate(p))
  const aw = lineupAway.map(p => getGoalsRate(p))

  const events: Array<{ minute: number; side: 'home' | 'away'; player: Player }> = []
  for (let i = 0; i < homeGoals; i++) {
    const m = Math.ceil(state.minute + Math.random() * interval)
    events.push({ minute: m, side: 'home', player: lineupHome[weightedPickIdx(hw)] })
  }
  for (let i = 0; i < awayGoals; i++) {
    const m = Math.ceil(state.minute + Math.random() * interval)
    events.push({ minute: m, side: 'away', player: lineupAway[weightedPickIdx(aw)] })
  }
  events.sort((a, b) => a.minute - b.minute)

  for (const ev of events) {
    if (ev.side === 'home') state.scoreHome++
    else state.scoreAway++
    state.log.push({
      minute: ev.minute,
      kind: 'background',
      text: `Gol de ${ev.player.name} (${ev.side === 'home' ? 'local' : 'visita'}). ${state.scoreHome}-${state.scoreAway}.`,
    })
  }
  state.minute = toMinute
}

// ── Match utilities ───────────────────────────────────────────────────────────

export function createMatchState(): MatchState {
  return {
    minute: 0, scoreHome: 0, scoreAway: 0,
    redCardsHome: 0, redCardsAway: 0,
    userSide: 'home', possession: 'home', lastOutcomeType: null, log: [],
  }
}

export function cloneState(s: MatchState): MatchState {
  return { ...s, log: [...s.log] }
}

export function decisionMinute(n: number, total: number): number {
  return Math.round((90 * n) / total)
}

export function extractBgEvents(state: MatchState, since: number): string[] {
  return state.log.filter(e => e.kind === 'background' && e.minute > since).map(e => e.text)
}

// ── Gemini client ─────────────────────────────────────────────────────────────

const GEMINI_MODEL   = 'gemini-3.1-flash-lite'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

class GeminiRateLimitError extends Error {
  constructor() { super('Gemini 429: rate limit'); this.name = 'GeminiRateLimitError' }
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string
  if (!key || key === 'your_key_here') {
    console.error('[Gemini] API key no configurada. Creá .env.local con VITE_GEMINI_API_KEY=tu_key')
    throw new Error('VITE_GEMINI_API_KEY not configured')
  }

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 1.0 },
    }),
  })

  if (res.status === 429) {
    const body429 = await res.text()
    console.error('[Gemini] 429 body:', body429)
    throw new GeminiRateLimitError()
  }
  if (!res.ok) {
    const body = await res.text()
    console.error(`[Gemini] HTTP ${res.status}:`, body)
    throw new Error(`Gemini ${res.status}: ${body}`)
  }
  const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini: empty response')
  return text
}

// Retry with backoff — longer wait on 429
async function callGeminiWithRetry(systemPrompt: string, userPrompt: string, maxAttempts = 3): Promise<string> {
  const delays = [0, 4000, 8000]
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (delays[attempt] > 0) await new Promise<void>(r => setTimeout(r, delays[attempt]))
    try {
      return await callGemini(systemPrompt, userPrompt)
    } catch (err) {
      const isRateLimit = err instanceof GeminiRateLimitError
      const isLast = attempt === maxAttempts - 1
      if (isLast) throw err
      if (isRateLimit) {
        console.warn(`[Gemini] 429 rate limit — esperando ${delays[attempt + 1] ?? 8000}ms...`)
      }
    }
  }
  throw new Error('Gemini: all attempts failed')
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  try { return JSON.parse(trimmed) as Record<string, unknown> } catch { /* */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) { try { return JSON.parse(fenced[1].trim()) as Record<string, unknown> } catch { /* */ } }
  const brace = trimmed.match(/\{[\s\S]*\}/)
  if (brace) { try { return JSON.parse(brace[0]) as Record<string, unknown> } catch { /* */ } }
  return null
}

// ── Narration helpers ─────────────────────────────────────────────────────────

function matchContext(scoreHome: number, scoreAway: number, minute: number, _userSide: 'home'): string {
  const myGoals  = scoreHome
  const oppGoals = scoreAway
  const diff     = myGoals - oppGoals
  const timeLeft = 90 - minute
  if (diff > 1)  return `vas ganando ${myGoals}-${oppGoals}, el partido está controlado`
  if (diff === 1) return timeLeft > 20
    ? `vas ganando ${myGoals}-${oppGoals}, pero el partido no está cerrado`
    : `vas ganando ${myGoals}-${oppGoals} y el tiempo corre a favor`
  if (diff === 0) return timeLeft > 20
    ? `el partido está empatado ${myGoals}-${oppGoals}, todo por definirse`
    : `empatados ${myGoals}-${oppGoals} y el tiempo se acaba, el que gane pasa`
  if (diff === -1) return timeLeft > 20
    ? `vas perdiendo ${myGoals}-${oppGoals}, necesitás el gol`
    : `perdiendo ${myGoals}-${oppGoals} con ${timeLeft} minutos, es urgente`
  return `vas perdiendo ${myGoals}-${oppGoals}, el partido se complica seriamente`
}

function positionRole(pos: Pos, overall: number): string {
  const quality = overall >= 80 ? 'uno de los mejores del equipo' : overall >= 70 ? 'referente del medio' : 'jugador del plantel'
  switch (pos) {
    case 'DEL': return overall >= 80 ? 'tu goleador, la referencia ofensiva' : 'tu delantero'
    case 'MED': return overall >= 80 ? 'el motor del mediocampo, creador' : 'mediocampista'
    case 'DEF': return overall >= 80 ? 'el líder defensivo, sólido en el fondo' : 'defensor'
    case 'ARQ': return 'el arquero'
    default:    return quality
  }
}

const ACTION_WHAT: Record<ActionType, string> = {
  shoot:          'rematar directamente al arco desde su posición actual',
  long_shot:      'intentar el remate de larga distancia, fuera del área',
  through_ball:   'filtrar el pase en profundidad para habilitar a un compañero en carrera',
  cross:          'tirar el centro al área para que los delanteros cabeceen',
  dribble:        'encarar al defensor e intentar superarlo en el uno contra uno',
  hold_play:      'aguantar la pelota, ganar tiempo y esperar una mejor opción de pase',
  tackle:         'ir a buscar la pelota con una entrada fuerte para cortar el ataque',
  hold_position:  'mantener la posición y esperar el momento sin arriesgar la entrada',
  tactical_foul:  'cometer la falta táctica para cortar la jugada antes de que sea peligrosa',
  clear:          'despejar el balón lejos del área sin importar hacia dónde, solo sacar el peligro',
}

// ── System prompts ────────────────────────────────────────────────────────────

const DECISION_SYSTEM_PROMPT = `
Sos Mariano Closs narrando un partido por radio. Sos el mejor relator del fútbol argentino:
fluido, apasionado, describe la escena exacta con nombres y movimientos, no resúmenes abstractos.

CÓMO SUENA TU RELATO — ejemplos del estilo que tenés que imitar:

Ataque: "La tiene Romero al borde del área chica, Díaz se la pide por su izquierda a toda velocidad,
Romero la aguanta, la aguanta... aparece Méndez por el medio que se metió sin que nadie lo marque,
la pelota está ahí para alguien. ¿Quién la toma?"

Defensa: "El pase largo del rival cayó en Suárez, entró por la derecha y ya dejó a dos en el camino,
se va hacia el área, Gómez lo persigue pero llegó tarde, Suárez la tiene solo frente al arco...
tenés que resolverlo ahora."

Eso es lo que hacés. Describís la escena física: dónde está la pelota, cómo se mueven los jugadores,
qué peligro hay o qué oportunidad. Nombrás a la gente por apellido. Hacés sentir el partido.

REGLAS FIJAS (no las rompés nunca):
1. options: EXACTAMENTE los mismos elementos que candidateActions, en el MISMO ORDEN.
2. No inventés goles ni eventos que no estén en el input.
3. DEFENSA: el rival ataca, vos tenés que cortar. Describí al rival moviéndose, qué peligro genera.
   situation arranca con "🛡️ DEFENDÉS —"
4. ATAQUE: tu equipo tiene la pelota, hay una chance. Describí la jugada que se armó.
   situation arranca con "⚔️ ATACÁS —"
5. labels de options: que el usuario entienda qué acción concreta ejecuta su jugador (7-10 palabras).

OUTPUT — JSON exacto, sin texto fuera del JSON:
{
  "narration": "3-5 frases de relato al estilo Closs — la escena, los jugadores, el momento",
  "situation": "2 frases — el instante bisagra, arrancá con el emoji+label, nombrá al jugador principal",
  "options": [{ "action": "exacto como en candidateActions", "label": "acción concreta 7-10 palabras" }]
}
`.trim()

const OUTCOME_SYSTEM_PROMPT = `
Sos Mariano Closs narrando el desenlace de una jugada. El resultado ya está definido —
tu trabajo es describir cómo sucedió, con la misma energía de radio argentina que te caracteriza.

OUTPUT JSON exacto: { "text": "<narración>" }

ESTILO — cómo suena:
Gol: "La mandó Romero, cruzada, el arquero se tiró pero no llegó... GOOOL de Romero,
      goool del equipo, qué golazo en el momento justo."
Atajada: "Romero la mandó al palo derecho, el arquero se estiró de manera increíble y la desvió al córner.
         Estuvo. Estuvo muy cerca."
Pérdida: "Romero la intentó pero el defensor le cerró el camino, le robó la pelota limpio
          y el rival ya está corriendo hacia el otro lado."

REGLAS:
- 3-4 frases. Presente narrativo. Describí la acción física concreta, no solo el resultado abstracto.
- goal + goleador: explosión, nombrá al goleador, describí cómo fue el remate o el movimiento.
- saved: describí la atajada — al palo, con el cuerpo, mano a mano, voló por los aires, etc.
- off_target / blocked: la chance se fue. Describí por dónde, la decepción.
- chance_created: se abrió una oportunidad clara, describí el movimiento que la generó.
- possession_lost: perdieron la pelota, describí el robo o la pérdida y qué hace el rival ahora.
- danger_stopped / cleared: el defensor resolvió, describí la acción defensiva.
- yellow_card / red_card: el árbitro saca la tarjeta, dramatismo, describí la falta o la situación.
- penalty: se cobra, describí el contacto, la tensión del momento.
- golRival=true: el rival convierte aprovechando el error. Dolor, describí cómo fue el gol rival.
- jugadaCombinada=true: jugada en dos tiempos — narrala como un solo movimiento continuo y fluido.
`.trim()

// ── Fallback labels ───────────────────────────────────────────────────────────

export const DEFAULT_ACTION_LABELS: Record<ActionType, string> = {
  shoot:          'Definir al arco ahora mismo',
  long_shot:      'Sacar el cañonazo de media distancia',
  through_ball:   'Habilitar al compañero con el pase',
  cross:          'Mandar el centro al área',
  dribble:        'Encarar al defensor y superarlo',
  hold_play:      'Aguantar la pelota y esperar opción',
  tackle:         'Entrar fuerte a recuperar el balón',
  hold_position:  'Mantenerme y esperar el momento',
  tactical_foul:  'Cometer la falta táctica para cortar',
  clear:          'Despejar lejos sin arriesgar',
}

// ── narrateDecision ───────────────────────────────────────────────────────────

function buildDecisionPrompt(
  state: MatchState,
  dp: DecisionPoint,
  homeTeam: string,
  awayTeam: string,
): string {
  const isDefense   = dp.situationType === 'defense'
  const ctx         = matchContext(state.scoreHome, state.scoreAway, state.minute, state.userSide)
  const primaryRole = positionRole(dp.primary.position, dp.primary.overall)
  const supportDesc = dp.supporting.map(p => `${p.name} (${p.position}, ${p.overall} overall)`).join(' y ')
  const keeperDesc  = dp.keeper   ? `Arquero rival: ${dp.keeper.name} (${dp.keeper.overall} overall).` : ''
  const defDesc     = dp.defender ? `Tu defensor que resuelve: ${dp.defender.name} (${dp.defender.position}, ${dp.defender.overall} overall).` : ''

  const actionsDesc = dp.candidateActions
    .map(a => `  • ${a}: ${ACTION_WHAT[a]}`)
    .join('\n')

  const defSubTypeDesc =
    dp.defensiveSubType === 'dribbler'   ? 'El rival viene driblando con la pelota pegada al pie — no hay pelota dividida para despejar, hay que cortarlo antes de que entre.' :
    dp.defensiveSubType === 'aerial'     ? 'Viene un centro o pelota aérea al área — hay que ganar el duelo aéreo o despejar de cabeza antes de que caiga al pie de un delantero.' :
    dp.defensiveSubType === 'loose_ball' ? 'La pelota está dividida en el área — hay que llegar primero y resolver antes de que el rival la controle.' :
    ''

  const whoAndWhat = isDefense
    ? `EL RIVAL ESTÁ ATACANDO.
Tu defensor que debe resolver: ${dp.defender?.name ?? dp.primary.name} (${dp.defender?.position ?? dp.primary.position}, ${dp.defender?.overall ?? dp.primary.overall} overall).
El rival que lleva la pelota: ${dp.primary.name} (${dp.primary.position}, ${dp.primary.overall} overall — ${primaryRole} del rival).
${supportDesc ? `Compañeros del rival en la jugada: ${supportDesc}.` : ''}
${keeperDesc}
${defSubTypeDesc ? `TIPO DE JUGADA DEFENSIVA: ${defSubTypeDesc}` : ''}`
    : `TU EQUIPO ESTÁ ATACANDO.
Jugador con la pelota: ${dp.primary.name} (${dp.primary.position}, ${dp.primary.overall} overall — ${primaryRole}).
${supportDesc ? `Compañeros disponibles: ${supportDesc}.` : ''}
${keeperDesc}
${defDesc}`

  return `PARTIDO: ${homeTeam} vs ${awayTeam}
MINUTO: ${dp.minute}'
MARCADOR: ${homeTeam} ${state.scoreHome} — ${state.scoreAway} ${awayTeam}
CONTEXTO: ${ctx}.

${whoAndWhat}

ACCIONES POSIBLES (candidateActions — en este orden exacto):
${actionsDesc}

Generá el JSON de narración. En "options" incluí EXACTAMENTE ${dp.candidateActions.length} elementos en el MISMO ORDEN que candidateActions.`
}

export async function narrateDecision(
  state: MatchState,
  dp: DecisionPoint,
  homeTeam: string,
  awayTeam: string,
): Promise<NarratedDecision> {
  const fallback = (): NarratedDecision => ({
    narration: `Minuto ${dp.minute}. El partido está ${state.scoreHome}-${state.scoreAway}.`,
    situation: `${dp.primary.name} tiene la pelota. Hay que decidir.`,
    options: dp.candidateActions.map(action => ({ action, label: DEFAULT_ACTION_LABELS[action] })),
  })

  try {
    const raw    = await callGeminiWithRetry(DECISION_SYSTEM_PROMPT, buildDecisionPrompt(state, dp, homeTeam, awayTeam))
    const parsed = extractJson(raw) ?? {}
    const narration = typeof parsed.narration === 'string' && parsed.narration.trim()
      ? parsed.narration
      : `Minuto ${dp.minute}. El equipo llega a una situación importante.`
    const situation = typeof parsed.situation === 'string' && parsed.situation.trim()
      ? parsed.situation
      : `${dp.primary.name} tiene la pelota. Hay que decidir.`

    const labelByAction = new Map<string, string>()
    if (Array.isArray(parsed.options)) {
      for (const opt of parsed.options as Array<Record<string, unknown>>) {
        if (typeof opt.action === 'string' && typeof opt.label === 'string' && opt.label.trim()) {
          labelByAction.set(opt.action, opt.label.trim())
        }
      }
    }
    const options: NarratedOption[] = dp.candidateActions.map(action => ({
      action,
      label: labelByAction.get(action) ?? DEFAULT_ACTION_LABELS[action],
    }))

    return { narration, situation, options }
  } catch (err) {
    console.error('[Gemini] narrateDecision falló definitivamente:', err)
    return fallback()
  }
}

// ── narrateOutcome ────────────────────────────────────────────────────────────

function buildOutcomePrompt(
  state: MatchState,
  action: ActionType,
  outcome: ActionOutcome,
  homeTeam: string,
  awayTeam: string,
): string {
  const ctx       = matchContext(state.scoreHome, state.scoreAway, state.minute, state.userSide)
  const whatDid   = ACTION_WHAT[action] ?? action
  const scorerStr = outcome.scorer    ? ` Lo convirtió ${outcome.scorer.name}.`  : ''
  const assStr    = outcome.assister  ? ` Asistencia de ${outcome.assister.name}.` : ''
  const cardStr   = outcome.cardOn    ? ` La tarjeta fue para ${outcome.cardOn.name}.` : ''
  const rivalGol  = outcome.opponentGoal
    ? `\nATENCIÓN: EL RIVAL CONVIRTIÓ aprovechando el error. Goleador rival: ${outcome.concededScorer?.name ?? 'delantero rival'}.`
    : ''
  const combined  = outcome.secondaryGoal ? '\nFue una jugada en dos tiempos (chance creada + remate de seguimiento).' : ''

  return `PARTIDO: ${homeTeam} ${state.scoreHome} — ${state.scoreAway} ${awayTeam} · MIN ${state.minute}'
CONTEXTO: ${ctx}.

EL USUARIO DECIDIÓ: ${whatDid}.
RESULTADO: ${outcome.result}.${scorerStr}${assStr}${cardStr}${rivalGol}${combined}

Narrá el desenlace en 3-4 frases de relato en presente. Construí la tensión antes de revelar qué pasó.`
}

const OUTCOME_FALLBACKS: Record<string, string> = {
  goal:           '¡Golazo! La pelota termina en el fondo de la red.',
  saved:          'El arquero le ahoga el grito. Atajada.',
  off_target:     'El remate se va desviado, afuera.',
  blocked:        'Le bloquean el tiro antes de que llegue al arco.',
  chance_created: 'La jugada genera una chance clara de gol.',
  possession_lost:'La pelota se pierde, se va a manos del rival.',
  foul_won:       'Lo faulean. Pelota parada para el equipo.',
  cleared:        'El defensor despeja el peligro.',
  danger_stopped: 'El peligro queda neutralizado.',
  yellow_card:    'Tarjeta amarilla. El árbitro no perdonó.',
  red_card:       'Tarjeta roja. Se va a los vestuarios.',
  penalty:        'Penal para el equipo atacante.',
  penalty_missed: 'El penal se fue afuera. El arquero se salva.',
}

export async function narrateOutcome(
  state: MatchState,
  action: ActionType,
  outcome: ActionOutcome,
  homeTeam: string,
  awayTeam: string,
): Promise<NarratedOutcome> {
  const fallbackText = outcome.opponentGoal
    ? `${outcome.concededScorer?.name ?? 'El delantero rival'} no perdona. El rival convierte.`
    : (OUTCOME_FALLBACKS[outcome.result] ?? 'La jugada queda sin definición.')

  try {
    const raw    = await callGeminiWithRetry(OUTCOME_SYSTEM_PROMPT, buildOutcomePrompt(state, action, outcome, homeTeam, awayTeam))
    const parsed = extractJson(raw)
    if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) return { text: parsed.text }
  } catch (err) {
    console.error('[Gemini] narrateOutcome falló:', err)
  }
  return { text: fallbackText }
}

// ── Rival / keeper helpers (adapted from adventure-service.ts) ────────────────

export function pickShooter(dp: DecisionPoint, action: ActionType): Player {
  if (action === 'dribble') return dp.primary
  return dp.supporting[0] ?? dp.primary
}

export function isUserDefensiveError(action: ActionType, result: ActionResult): boolean {
  return (
    (action === 'hold_position' && result === 'possession_lost') ||
    (action === 'clear'         && result === 'chance_created')
  )
}

export function pickRivalStriker(lineup: Player[]): Player {
  const fwds = lineup.filter(p => p.position === 'DEL')
  return fwds[0] ?? lineup[0]
}

export function findKeeper(lineup: Player[]): Player | null {
  return lineup.find(p => p.position === 'ARQ') ?? null
}

export { teamDisplayName }
