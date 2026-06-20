export type Position = 'ARQ' | 'DEF' | 'MED' | 'DEL'

export interface Player {
  id: string
  name: string
  team: string
  position: Position
  overall: number
  value: number
  goals: number
  assists: number
  minutes: number
  appearances: number
  yellowCards: number
  redCards: number
  cleanSheets: number
}

export type Formation = '4-3-3' | '4-4-2' | '3-5-2' | '4-2-3-1' | '3-4-3' | '5-3-2'

export interface DailyChallenge {
  date: string
  rival: RivalTeam
  blockedPlayerIds: string[]
}

export interface RivalTeam {
  name: string
  players: Player[]
  formation: Formation
}

export type GameMode = 'sim' | 'adventure' | 'multiplayer'
