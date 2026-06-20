import { useState, useRef, useEffect } from 'react'
import type { Player, RivalTeam } from '../types'
import {
  createMatchState, cloneState, advanceInterval, generateDecisionPoint,
  buildActionInput, resolveAction, resolveSecondaryShot, applyOutcome,
  narrateDecision, narrateOutcome, extractBgEvents, decisionMinute,
  pickShooter, pickRivalStriker, findKeeper, isUserDefensiveError,
  TOTAL_DECISIONS, teamDisplayName, STRATEGIES,
} from '../lib/adventure'
import type { MatchState, DecisionPoint, NarratedDecision, NarratedOption, ActionType, SituationType, GameStrategy } from '../lib/adventure'

const ROUND_LABELS = ['Cuartos de Final', 'Semifinal', 'Final']

const PAGE: React.CSSProperties = {
  background: '#101319',
  maxWidth: '640px',
  margin: '0 auto',
  width: '100%',
}

// ── Feed entry types ──────────────────────────────────────────────────────────

type FeedEntry =
  | { id: string; kind: 'round-start'; round: number; rivalName: string }
  | { id: string; kind: 'bg-event'; minute: number; text: string; isGoal: boolean; side: 'home' | 'away' }
  | { id: string; kind: 'narration'; minute: number; situationType: SituationType; text: string; situation: string; decisionN: number }
  | { id: string; kind: 'user-choice'; action: ActionType; label: string }
  | { id: string; kind: 'outcome'; text: string; scoreHome: number; scoreAway: number; minute: number }
  | { id: string; kind: 'loading'; hint: string }
  | { id: string; kind: 'round-end'; won: boolean; scoreHome: number; scoreAway: number; round: number; rivalName: string }

type BottomBar =
  | { kind: 'hidden' }
  | { kind: 'decision'; options: NarratedOption[]; point: DecisionPoint }
  | { kind: 'continue'; label: string }
  | { kind: 'halftime'; currentStrategy: GameStrategy }
  | { kind: 'next-round'; nextLabel: string }
  | { kind: 'eliminated' }
  | { kind: 'champion' }

interface Props {
  squad: Player[]
  rivals: RivalTeam[]
  dateSeed: number
  remainingAttempts: number
  onBack: () => void
  onReplay: () => void
}

let _entryId = 0
const uid = () => String(++_entryId)

export default function Adventure({ squad, rivals, remainingAttempts, onBack, onReplay }: Props) {
  const [phase, setPhase]             = useState<'preview' | 'active'>('preview')
  const [feed, setFeed]               = useState<FeedEntry[]>([])
  const [bottom, setBottom]           = useState<BottomBar>({ kind: 'hidden' })
  const [matchState, setMatchState]   = useState<MatchState>(createMatchState())
  const [decisionsMade, setDecisionsMade] = useState(0)
  // Pre-fetched next decision (while user reads outcome)
  const [nextMatchState, setNextMatchState]   = useState<MatchState | null>(null)
  const [nextBgEvents, setNextBgEvents]       = useState<string[]>([])
  const [nextNarrated, setNextNarrated]       = useState<NarratedDecision | null>(null)
  const [nextPendingPoint, setNextPendingPoint] = useState<DecisionPoint | null>(null)
  const [strategy, setStrategy]                   = useState<GameStrategy>('balanced')
  const [recentPrimaryIds, setRecentPrimaryIds]   = useState<string[]>([])
  const [recentDefenderIds, setRecentDefenderIds] = useState<string[]>([])
  const [, setRoundResults] = useState<{ my: number; rival: number }[]>([])
  const [round, setRound]               = useState(0)

  const busy    = useRef(false)
  const feedRef = useRef<HTMLDivElement>(null)

  const currentRival = rivals[round]
  const homeLineup   = squad
  const awayLineup   = currentRival?.players ?? []
  const homeTeam     = 'Tu Equipo'
  const awayTeam     = teamDisplayName(currentRival?.name ?? '')

  // Auto-scroll feed to bottom on new entries
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [feed])

  // ── Feed helpers ────────────────────────────────────────────────────────────

  function pushEntry(entry: FeedEntry) {
    setFeed(prev => [...prev, entry])
  }

  function replaceLoading(entry: FeedEntry) {
    setFeed(prev => {
      const withoutLoading = prev.filter(e => e.kind !== 'loading')
      return [...withoutLoading, entry]
    })
  }

  function removeLoading() {
    setFeed(prev => prev.filter(e => e.kind !== 'loading'))
  }

  function pushBgEvents(events: string[], state: MatchState) {
    for (const text of events) {
      const isGoal = text.includes('Gol de')
      const side: 'home' | 'away' = text.includes('(local)') ? 'home' : 'away'
      pushEntry({ id: uid(), kind: 'bg-event', minute: state.minute, text, isGoal, side })
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePlay() {
    if (busy.current) return
    busy.current = true
    try {
      const state = createMatchState()
      setFeed([
        { id: uid(), kind: 'round-start', round, rivalName: awayTeam },
      ])
      setBottom({ kind: 'hidden' })
      setPhase('active')

      // Loading card while Gemini generates decision 1
      const loadId = uid()
      setFeed(prev => [...prev, { id: loadId, kind: 'loading', hint: 'Arrancando el partido…' }])

      const toMin = decisionMinute(1, TOTAL_DECISIONS)
      advanceInterval(state, toMin, homeLineup, awayLineup, strategy)
      const evs = extractBgEvents(state, 0)

      setFeed(prev => {
        const base = prev.filter(e => e.kind !== 'loading')
        const bgCards: FeedEntry[] = evs.map(text => ({
          id: uid(), kind: 'bg-event' as const,
          minute: state.minute, text,
          isGoal: text.includes('Gol de'),
          side: (text.includes('(local)') ? 'home' : 'away') as 'home' | 'away',
        }))
        return [...base, ...bgCards, { id: uid(), kind: 'loading', hint: 'Generando la primera jugada…' }]
      })

      const dp = generateDecisionPoint(state, homeLineup, awayLineup, [], [], strategy)
      const nd = await narrateDecision(state, dp, homeTeam, awayTeam)

      setMatchState(state)
      setDecisionsMade(0)
      setRecentPrimaryIds([])
      setRecentDefenderIds([])

      replaceLoading({
        id: uid(), kind: 'narration',
        minute: state.minute,
        situationType: dp.situationType,
        text: nd.narration,
        situation: nd.situation,
        decisionN: 1,
      })
      setBottom({ kind: 'decision', options: nd.options, point: dp })
    } catch (err) {
      console.error('Adventure play error:', err)
      removeLoading()
      setBottom({ kind: 'hidden' })
    } finally {
      busy.current = false
    }
  }

  async function handleDecide(action: ActionType, point: DecisionPoint) {
    if (busy.current) return
    busy.current = true
    try {
      setBottom({ kind: 'hidden' })

      // Show what the user picked
      const chosenLabel = point.candidateActions.includes(action)
        ? (bottom.kind === 'decision' ? bottom.options.find(o => o.action === action)?.label ?? action : action)
        : action
      pushEntry({ id: uid(), kind: 'user-choice', action, label: chosenLabel })
      pushEntry({ id: uid(), kind: 'loading', hint: 'Resolviendo la jugada…' })

      const input = buildActionInput(point, action)
      let outcome = resolveAction(input, strategy)

      if (outcome.result === 'chance_created' && point.situationType === 'attack') {
        const shooter = pickShooter(point, action)
        const sec     = resolveSecondaryShot(shooter, findKeeper(awayLineup), outcome.xg)
        if (sec.goal) outcome = { ...outcome, result: 'goal', scorer: shooter, secondaryGoal: true }
      }

      if (isUserDefensiveError(action, outcome.result)) {
        const rivalStriker = pickRivalStriker(awayLineup)
        const rivalKeeper  = findKeeper(homeLineup)
        const sec = resolveSecondaryShot(rivalStriker, rivalKeeper, 0.12)
        if (sec.goal) outcome = { ...outcome, opponentGoal: true, concededScorer: rivalStriker }
      }

      const newState         = cloneState(matchState)
      applyOutcome(newState, point, outcome, homeLineup, awayLineup)
      const newDecisionsMade   = decisionsMade + 1
      const newRecentIds       = [...recentPrimaryIds, point.primary.id].slice(-3)
      const newRecentDefIds    =
        point.situationType === 'defense' && point.defender
          ? [...recentDefenderIds, point.defender.id].slice(-2)
          : point.situationType === 'attack'
          ? [...recentDefenderIds, point.primary.id].slice(-2)
          : recentDefenderIds

      const isHalftime = newDecisionsMade === TOTAL_DECISIONS / 2
      const isLastDecision = newDecisionsMade >= TOTAL_DECISIONS

      if (isLastDecision) {
        setFeed(prev => prev.map(e => e.kind === 'loading' ? { ...e, hint: 'Narrando el final…' } : e))
        const narratedOut = await narrateOutcome(newState, action, outcome, homeTeam, awayTeam)

        replaceLoading({ id: uid(), kind: 'outcome', text: narratedOut.text, scoreHome: newState.scoreHome, scoreAway: newState.scoreAway, minute: newState.minute })
        setMatchState(newState)
        setDecisionsMade(newDecisionsMade)
        setRecentPrimaryIds(newRecentIds)
        setRecentDefenderIds(newRecentDefIds)

        const won = newState.scoreHome > newState.scoreAway
        setNextMatchState(null)
        setNextNarrated(null)
        setNextPendingPoint(null)
        setNextBgEvents([])
        setRoundEndState({ won, scoreHome: newState.scoreHome, scoreAway: newState.scoreAway })
        setBottom({ kind: 'continue', label: 'Ver resultado final' })
      } else if (isHalftime) {
        setFeed(prev => prev.map(e => e.kind === 'loading' ? { ...e, hint: 'Narrando la jugada…' } : e))
        const narratedOut = await narrateOutcome(newState, action, outcome, homeTeam, awayTeam)

        replaceLoading({ id: uid(), kind: 'outcome', text: narratedOut.text, scoreHome: newState.scoreHome, scoreAway: newState.scoreAway, minute: newState.minute })
        setMatchState(newState)
        setDecisionsMade(newDecisionsMade)
        setRecentPrimaryIds(newRecentIds)
        setRecentDefenderIds(newRecentDefIds)
        setNextMatchState(null)
        setNextNarrated(null)
        setNextPendingPoint(null)
        setNextBgEvents([])
        setBottom({ kind: 'halftime', currentStrategy: strategy })
      } else {
        setFeed(prev => prev.map(e => e.kind === 'loading' ? { ...e, hint: 'Generando el relato…' } : e))

        const nextDecN     = newDecisionsMade + 1
        const nextMin      = decisionMinute(nextDecN, TOTAL_DECISIONS)
        const stateForNext = cloneState(newState)
        advanceInterval(stateForNext, nextMin, homeLineup, awayLineup, strategy)
        const evs = extractBgEvents(stateForNext, newState.minute)
        const dp2 = generateDecisionPoint(stateForNext, homeLineup, awayLineup, newRecentIds, newRecentDefIds, strategy)

        const narratedOut = await narrateOutcome(newState, action, outcome, homeTeam, awayTeam)
        const nd2         = await narrateDecision(stateForNext, dp2, homeTeam, awayTeam)

        replaceLoading({ id: uid(), kind: 'outcome', text: narratedOut.text, scoreHome: newState.scoreHome, scoreAway: newState.scoreAway, minute: newState.minute })
        setMatchState(newState)
        setDecisionsMade(newDecisionsMade)
        setRecentPrimaryIds(newRecentIds)
        setRecentDefenderIds(newRecentDefIds)
        setNextMatchState(stateForNext)
        setNextBgEvents(evs)
        setNextNarrated(nd2)
        setNextPendingPoint(dp2)
        setBottom({ kind: 'continue', label: 'Continuar →' })
      }
    } catch (err) {
      console.error('Adventure decide error:', err)
      removeLoading()
      setBottom(bottom)
    } finally {
      busy.current = false
    }
  }

  const [roundEndState, setRoundEndState] = useState<{ won: boolean; scoreHome: number; scoreAway: number } | null>(null)

  async function handleHalftimeContinue(newStrategy: GameStrategy) {
    if (busy.current) return
    busy.current = true
    try {
      setStrategy(newStrategy)
      setBottom({ kind: 'hidden' })
      pushEntry({ id: uid(), kind: 'loading', hint: 'Arrancando el segundo tiempo…' })

      const nextDecN     = decisionsMade + 1
      const nextMin      = decisionMinute(nextDecN, TOTAL_DECISIONS)
      const stateForNext = cloneState(matchState)
      advanceInterval(stateForNext, nextMin, homeLineup, awayLineup, newStrategy)
      const evs = extractBgEvents(stateForNext, matchState.minute)
      const dp  = generateDecisionPoint(stateForNext, homeLineup, awayLineup, recentPrimaryIds, recentDefenderIds, newStrategy)
      const nd  = await narrateDecision(stateForNext, dp, homeTeam, awayTeam)

      pushBgEvents(evs, stateForNext)
      replaceLoading({
        id: uid(), kind: 'narration',
        minute: stateForNext.minute,
        situationType: dp.situationType,
        text: nd.narration,
        situation: nd.situation,
        decisionN: nextDecN,
      })
      setMatchState(stateForNext)
      setBottom({ kind: 'decision', options: nd.options, point: dp })
    } catch (err) {
      console.error('Halftime error:', err)
      removeLoading()
    } finally {
      busy.current = false
    }
  }

  function handleContinue() {
    if (decisionsMade >= TOTAL_DECISIONS) {
      if (!roundEndState) return
      const { won, scoreHome, scoreAway } = roundEndState
      pushEntry({ id: uid(), kind: 'round-end', won, scoreHome, scoreAway, round, rivalName: awayTeam })
      setRoundEndState(null)

      if (won) {
        if (round >= rivals.length - 1) {
          setBottom({ kind: 'champion' })
        } else {
          setRoundResults(prev => [...prev, { my: scoreHome, rival: scoreAway }])
          setBottom({ kind: 'next-round', nextLabel: ROUND_LABELS[round + 1] })
        }
      } else {
        setBottom({ kind: 'eliminated' })
      }
    } else {
      // Move to next decision (pre-fetched)
      const ms  = nextMatchState!
      const evs = nextBgEvents
      const nd  = nextNarrated!
      const dp  = nextPendingPoint!

      setMatchState(ms)
      setNextMatchState(null)
      setNextBgEvents([])
      setNextNarrated(null)
      setNextPendingPoint(null)

      // Push bg events for the interval that just advanced
      for (const text of evs) {
        const isGoal = text.includes('Gol de')
        const side: 'home' | 'away' = text.includes('(local)') ? 'home' : 'away'
        setFeed(prev => [...prev, { id: uid(), kind: 'bg-event', minute: ms.minute, text, isGoal, side }])
      }

      setFeed(prev => [...prev, {
        id: uid(), kind: 'narration',
        minute: ms.minute,
        situationType: dp.situationType,
        text: nd.narration,
        situation: nd.situation,
        decisionN: decisionsMade + 1,
      }])
      setBottom({ kind: 'decision', options: nd.options, point: dp })
    }
  }

  function handleNextRound() {
    const newRound = round + 1
    setRound(newRound)
    setMatchState(createMatchState())
    setDecisionsMade(0)
    setNextMatchState(null)
    setNextBgEvents([])
    setNextNarrated(null)
    setNextPendingPoint(null)
    setRecentPrimaryIds([])
    setRecentDefenderIds([])
    setRoundEndState(null)
    setPhase('preview')
  }

  const rivalName = teamDisplayName(currentRival?.name ?? '')

  // ── PREVIEW ───────────────────────────────────────────────────────────────
  if (phase === 'preview') {
    return (
      <div className="h-svh flex flex-col items-center justify-center px-4 gap-6 overflow-y-auto" style={PAGE}>
        <div className="text-center">
          <p className="text-label-caps text-[#75ff9e] tracking-widest mb-2">
            🎮 AVENTURA · {ROUND_LABELS[round].toUpperCase()}
          </p>
          <h2 className="text-headline-lg text-[#e1e2ea]">Próximo rival</h2>
        </div>

        <div
          className="rounded-2xl p-6 w-full max-w-sm text-center"
          style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}
        >
          <p className="text-label-caps text-[#859585] mb-3 tracking-widest">RIVAL</p>
          <p className="text-headline-lg text-[#e1e2ea]">{rivalName}</p>
          <p className="text-body-sm text-[#859585] mt-1">{currentRival.formation}</p>
        </div>

        <div className="w-full max-w-sm">
          <p className="text-label-caps text-[#859585] mb-2 px-1 tracking-widest">ESTRATEGIA</p>
          <StrategyPicker current={strategy} onSelect={setStrategy} />
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm">
          <button
            onClick={() => { void handlePlay() }}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            ⚽ Jugar partido
          </button>
          <button
            onClick={onBack}
            className="w-full font-bold py-3 rounded-xl text-body-sm text-[#bacbb9]"
            style={{ background: 'transparent', border: '1px solid #3b4a3d' }}
          >
            Abandonar
          </button>
        </div>
        <Animations />
      </div>
    )
  }

  // ── ACTIVE (feed view) ────────────────────────────────────────────────────
  return (
    <div className="h-svh flex flex-col" style={PAGE}>

      {/* ── Header ── */}
      <header
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: '#1d2025', borderColor: '#3b4a3d' }}
      >
        <button
          onClick={onBack}
          className="text-body-sm text-[#bacbb9] hover:text-[#e1e2ea] transition-colors shrink-0"
        >
          ← Inicio
        </button>
        <div className="flex-1 text-center min-w-0">
          {bottom.kind === 'hidden' ? (
            <span className="inline-flex items-center gap-1.5 text-label-caps font-bold text-[#ff5252]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff5252] shrink-0"
                style={{ animation: 'live-pulse 1s ease-in-out infinite' }} />
              PROCESANDO
            </span>
          ) : bottom.kind === 'decision' ? (
            <span className="inline-flex items-center gap-1.5 text-label-caps font-bold text-[#75ff9e]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#75ff9e] shrink-0"
                style={{ animation: 'live-pulse 1s ease-in-out infinite' }} />
              TU TURNO
            </span>
          ) : (
            <p className="text-body-sm font-semibold text-[#e1e2ea] truncate">
              🎮 {ROUND_LABELS[round]}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-label-caps text-[#859585]">MIN {matchState.minute}'</p>
          <p className="text-label-caps font-bold text-[#e1e2ea]">
            {matchState.scoreHome} — {matchState.scoreAway}
          </p>
        </div>
      </header>

      {/* ── Score panel ── */}
      <div className="shrink-0 px-4 py-4 text-center border-b" style={{ background: '#13171c', borderColor: '#272a30' }}>
        <div className="flex items-center justify-center gap-8">
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1">VOS</p>
            <p className="font-black leading-none text-[#e1e2ea]" style={{ fontSize: 'clamp(2rem,10vw,3.25rem)' }}>{matchState.scoreHome}</p>
          </div>
          <p className="text-headline-lg text-[#3b4a3d] font-bold mt-3">—</p>
          <div className="text-center">
            <p className="text-label-caps text-[#859585] mb-1 truncate max-w-[120px]">{rivalName.toUpperCase()}</p>
            <p className="font-black leading-none text-[#e1e2ea]" style={{ fontSize: 'clamp(2rem,10vw,3.25rem)' }}>{matchState.scoreAway}</p>
          </div>
        </div>
        <p className="text-label-caps text-[#859585] mt-2">
          {decisionsMade}/{TOTAL_DECISIONS} jugadas · {ROUND_LABELS[round]}
        </p>
      </div>

      {/* ── Feed ── */}
      <div
        ref={feedRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2 dark-scrollbar"
      >
        <p className="text-label-caps text-[#859585] px-1 mb-1">CRÓNICA</p>
        {feed.map(entry => (
          <FeedCard key={entry.id} entry={entry} />
        ))}
      </div>

      {/* ── Bottom bar ── */}
      <BottomArea
        bottom={bottom}
        matchState={matchState}
        remainingAttempts={remainingAttempts}
        onDecide={handleDecide}
        onContinue={handleContinue}
        onHalftime={s => { void handleHalftimeContinue(s) }}
        onNextRound={handleNextRound}
        onReplay={onReplay}
        onBack={onBack}
      />
      <Animations />
    </div>
  )
}

// ── FeedCard ─────────────────────────────────────────────────────────────────

function FeedCard({ entry }: { entry: FeedEntry }) {
  if (entry.kind === 'round-start') {
    return (
      <div
        className="rounded-xl p-3 text-center"
        style={{ background: '#1d2025', border: '1px solid #3b4a3d' }}
      >
        <p className="text-label-caps text-[#75ff9e] font-bold">{ROUND_LABELS[entry.round].toUpperCase()}</p>
        <p className="text-body-sm text-[#859585] mt-0.5">vs {entry.rivalName}</p>
      </div>
    )
  }

  if (entry.kind === 'bg-event') {
    const color = entry.isGoal
      ? (entry.side === 'home' ? '#75ff9e' : '#ffb4ab')
      : '#859585'
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{ background: '#191c21', border: `1px solid ${entry.isGoal ? (entry.side === 'home' ? '#75ff9e33' : '#ffb4ab33') : '#272a30'}` }}
      >
        <span className="text-label-caps shrink-0" style={{ color: '#859585' }}>{entry.minute}'</span>
        <span className="text-body-sm shrink-0">{entry.isGoal ? (entry.side === 'home' ? '⚽' : '💀') : '•'}</span>
        <p className="text-body-sm truncate" style={{ color }}>{entry.text}</p>
      </div>
    )
  }

  if (entry.kind === 'narration') {
    const isAttack = entry.situationType === 'attack'
    const borderColor = isAttack ? '#75ff9e55' : '#ffb4ab55'
    const headerColor = isAttack ? '#75ff9e' : '#ffb4ab'
    const headerLabel = isAttack ? '⚔️ ATACÁS' : '🛡️ DEFENDÉS'
    return (
      <div
        className="rounded-xl p-4 flex flex-col gap-2"
        style={{ background: '#1d2025', border: `1px solid ${borderColor}`, animation: 'event-in 0.3s ease-out' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-label-caps font-bold" style={{ color: headerColor }}>{headerLabel}</span>
          <span className="text-label-caps text-[#859585]">MIN {entry.minute}' · {entry.decisionN}/{TOTAL_DECISIONS}</span>
        </div>
        <p className="text-body-sm text-[#bacbb9] leading-relaxed">{entry.text}</p>
        <p className="text-body-sm font-semibold text-[#e1e2ea] leading-relaxed border-t pt-2" style={{ borderColor: '#272a30' }}>
          {entry.situation}
        </p>
      </div>
    )
  }

  if (entry.kind === 'user-choice') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
        style={{ background: '#75ff9e11', border: '1px solid #75ff9e33' }}
      >
        <span className="text-[#75ff9e] text-base shrink-0">✓</span>
        <p className="text-body-sm text-[#75ff9e] font-semibold">{entry.label}</p>
      </div>
    )
  }

  if (entry.kind === 'outcome') {
    return (
      <div
        className="rounded-xl p-4 flex flex-col gap-2"
        style={{ background: '#1d2025', border: '1px solid #272a30', animation: 'event-in 0.3s ease-out' }}
      >
        <p className="text-label-caps text-[#859585]">RELATO</p>
        <p className="text-body-sm text-[#e1e2ea] leading-relaxed">{entry.text}</p>
        <p className="text-label-caps text-[#859585] text-right">
          {entry.scoreHome} — {entry.scoreAway} · MIN {entry.minute}'
        </p>
      </div>
    )
  }

  if (entry.kind === 'round-end') {
    const won   = entry.won
    const color = won ? '#75ff9e' : '#ffb4ab'
    const label = won ? '🏆 VICTORIA' : (entry.scoreHome === entry.scoreAway ? '🤝 EMPATE — ELIMINADO' : '😔 ELIMINADO')
    return (
      <div
        className="rounded-xl p-4 text-center"
        style={{ background: '#1d2025', border: `1px solid ${color}33` }}
      >
        <p className="text-label-caps font-bold mb-2" style={{ color }}>{label}</p>
        <p className="text-[40px] font-black leading-none" style={{ color }}>
          {entry.scoreHome} <span className="text-[#3b4a3d]">—</span>{' '}
          <span className="text-[#e1e2ea]">{entry.scoreAway}</span>
        </p>
        <p className="text-label-caps text-[#859585] mt-2">vs {entry.rivalName} · {ROUND_LABELS[entry.round]}</p>
      </div>
    )
  }

  if (entry.kind === 'loading') {
    return (
      <div
        className="flex items-center gap-3 p-3 rounded-xl"
        style={{ background: '#1d2025', border: '1px solid #272a30' }}
      >
        <div className="flex gap-1 shrink-0">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#859585]"
              style={{ animation: `dot-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
        <span className="text-body-sm text-[#859585]">{entry.hint}</span>
      </div>
    )
  }

  return null
}

// ── StrategyPicker ────────────────────────────────────────────────────────────

export function StrategyPicker({ current, onSelect, compact = false }: { current: GameStrategy; onSelect: (s: GameStrategy) => void; compact?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(Object.keys(STRATEGIES) as GameStrategy[]).map(s => {
        const cfg       = STRATEGIES[s]
        const isActive  = s === current
        return (
          <button
            key={s}
            onClick={() => onSelect(s)}
            className="text-left rounded-xl transition-all"
            style={{
              padding: compact ? '10px 12px' : '12px 14px',
              background: isActive ? '#75ff9e18' : '#191c21',
              border: `1px solid ${isActive ? '#75ff9e' : '#3b4a3d'}`,
            }}
          >
            <p className="text-body-sm font-bold text-[#e1e2ea] mb-1">{cfg.label}</p>
            {cfg.pros.map(p => (
              <p key={p} className="text-label-caps" style={{ color: '#75ff9e', fontSize: '12px' }}>{p}</p>
            ))}
            {cfg.cons.map(c => (
              <p key={c} className="text-label-caps" style={{ color: '#ffb4ab', fontSize: '12px' }}>{c}</p>
            ))}
          </button>
        )
      })}
    </div>
  )
}

// ── BottomArea ────────────────────────────────────────────────────────────────

interface BottomProps {
  bottom: BottomBar
  matchState: MatchState
  remainingAttempts: number
  onDecide: (action: ActionType, point: DecisionPoint) => void
  onContinue: () => void
  onHalftime: (strategy: GameStrategy) => void
  onNextRound: () => void
  onReplay: () => void
  onBack: () => void
}

function BottomArea({ bottom, remainingAttempts, onDecide, onContinue, onHalftime, onNextRound, onReplay, onBack }: BottomProps) {
  if (bottom.kind === 'hidden') return null

  if (bottom.kind === 'decision') {
    const { options, point } = bottom
    const isAttack = point.situationType === 'attack'
    const accentColor = isAttack ? '#75ff9e' : '#ffb4ab'
    const accentBg    = isAttack ? '#75ff9e11' : '#ffb4ab11'
    const accentBorder= isAttack ? '#75ff9e33' : '#ffb4ab33'
    return (
      <div className="shrink-0 px-4 py-3 border-t flex flex-col gap-2" style={{ background: '#1d2025', borderColor: '#3b4a3d', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <p className="text-label-caps px-1" style={{ color: accentColor }}>
          {isAttack ? '⚔️ ¿QUÉ HACÉS?' : '🛡️ ¿CÓMO DEFENDÉS?'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {options.map(opt => (
            <button
              key={opt.action}
              onClick={() => onDecide(opt.action, point)}
              className="text-left p-3 rounded-xl transition-all text-body-sm font-semibold"
              style={{ background: accentBg, border: `1px solid ${accentBorder}`, color: '#e1e2ea' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = accentColor)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = accentBorder)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (bottom.kind === 'halftime') {
    const [selected, setSelected] = useState<GameStrategy>(bottom.currentStrategy)
    return (
      <div className="shrink-0 px-4 py-4 border-t flex flex-col gap-3" style={{ background: '#1d2025', borderColor: '#3b4a3d', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between">
          <p className="text-label-caps font-bold text-[#75ff9e]">⏸ DESCANSO · AJUSTE TÁCTICO</p>
          <p className="text-label-caps text-[#859585]">45'</p>
        </div>
        <StrategyPicker current={selected} onSelect={setSelected} compact />
        <button
          onClick={() => onHalftime(selected)}
          className="w-full font-bold py-3 rounded-xl text-body-lg transition-all electric-glow"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          Arrancar segundo tiempo →
        </button>
      </div>
    )
  }

  if (bottom.kind === 'continue') {
    return (
      <div className="shrink-0 px-4 py-4 border-t" style={{ background: '#1d2025', borderColor: '#3b4a3d', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <button
          onClick={onContinue}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          {bottom.label}
        </button>
      </div>
    )
  }

  if (bottom.kind === 'next-round') {
    return (
      <div className="shrink-0 px-4 py-4 border-t" style={{ background: '#1d2025', borderColor: '#3b4a3d', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <button
          onClick={onNextRound}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          Siguiente → {bottom.nextLabel}
        </button>
      </div>
    )
  }

  if (bottom.kind === 'eliminated') {
    return (
      <div className="shrink-0 px-4 py-4 border-t flex flex-col gap-2" style={{ background: '#1d2025', borderColor: '#3b4a3d', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {remainingAttempts > 0 ? (
          <button
            onClick={onReplay}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            🔄 Volver a armar equipo
            <span className="ml-2 text-label-caps opacity-70">
              ({remainingAttempts} {remainingAttempts === 1 ? 'chance' : 'chances'})
            </span>
          </button>
        ) : (
          <div
            className="w-full py-4 rounded-xl text-center text-body-sm text-[#859585]"
            style={{ background: '#191c21', border: '1px solid #3b4a3d' }}
          >
            Sin más chances hoy · Volvé mañana
          </div>
        )}
        <button
          onClick={onBack}
          className="w-full font-bold py-3 rounded-xl text-body-sm text-[#bacbb9]"
          style={{ background: 'transparent', border: '1px solid #3b4a3d' }}
        >
          Ir al inicio
        </button>
      </div>
    )
  }

  if (bottom.kind === 'champion') {
    return (
      <div className="shrink-0 px-4 py-4 border-t flex flex-col gap-2" style={{ background: '#1d2025', borderColor: '#3b4a3d', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="text-center py-2">
          <p className="text-[36px]">🏆</p>
          <p className="text-headline-lg font-black text-[#75ff9e]">¡Campeón!</p>
        </div>
        {remainingAttempts > 0 ? (
          <button
            onClick={onReplay}
            className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow"
            style={{ background: '#75ff9e', color: '#003918' }}
          >
            🔄 Volver a armar equipo
            <span className="ml-2 text-label-caps opacity-70">
              ({remainingAttempts} {remainingAttempts === 1 ? 'chance' : 'chances'})
            </span>
          </button>
        ) : (
          <div
            className="w-full py-4 rounded-xl text-center text-body-sm text-[#859585]"
            style={{ background: '#191c21', border: '1px solid #3b4a3d' }}
          >
            Sin más chances hoy · Volvé mañana
          </div>
        )}
        <button
          onClick={onBack}
          className="w-full font-bold py-3 rounded-xl text-body-sm text-[#bacbb9]"
          style={{ background: 'transparent', border: '1px solid #3b4a3d' }}
        >
          Ir al inicio
        </button>
      </div>
    )
  }

  return null
}

// ── Animations ────────────────────────────────────────────────────────────────

function Animations() {
  return (
    <style>{`
      @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      @keyframes dot-pulse  { 0%, 100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
      @keyframes event-in   { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    `}</style>
  )
}
