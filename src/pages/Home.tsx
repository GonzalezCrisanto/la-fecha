import { useEffect, useState } from 'react'
import { loadPlayers, getDailyChallenge, teamDisplayName } from '../lib/players'
import type { DailyChallenge, GameMode } from '../types'

interface Props {
  onPlay: (mode: GameMode) => void
  simAttempts: number
  adventureAttempts: number
  onResetAttempts: () => void
}

export default function Home({ onPlay, simAttempts, adventureAttempts, onResetAttempts }: Props) {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null)

  useEffect(() => {
    loadPlayers().then(players => setChallenge(getDailyChallenge(players)))
  }, [])

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div
      className="min-h-svh flex flex-col"
      style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,230,118,0.06) 0%, transparent 70%), #101319',
      }}
    >
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-8">
      {/* Título */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="text-xl">⚽</span>
          <span className="text-label-caps text-[#75ff9e] tracking-widest">FANTASY LPF</span>
        </div>
        <h1 className="text-display-lg text-[#e1e2ea] m-0 leading-tight">La Fecha</h1>
        <p className="text-body-lg text-[#bacbb9] mt-2">
          Armá tu once y jugá el desafío del día
        </p>
      </div>

      {/* Card rival del día */}
      {challenge ? (
        <div className="surface-card rounded-2xl p-6 w-full max-w-sm text-center">
          <p className="text-label-caps text-[#bacbb9] mb-3 tracking-widest">RIVAL DE HOY</p>
          <p className="text-headline-lg text-[#e1e2ea] leading-tight">
            {teamDisplayName(challenge.rival.name)}
          </p>
          <p className="text-body-sm text-[#bacbb9] mt-1">{challenge.rival.formation}</p>
          <div
            className="mt-4 pt-4 flex justify-center gap-4 text-label-caps text-[#859585]"
            style={{ borderTop: '1px solid #3b4a3d' }}
          >
            <span>
              ⚡ <span className={simAttempts > 0 ? 'text-[#75ff9e]' : 'text-[#ffb4ab]'}>{simAttempts}</span> chances
            </span>
            <span className="text-[#3b4a3d]">·</span>
            <span>
              🎮 <span className={adventureAttempts > 0 ? 'text-[#75ff9e]' : 'text-[#ffb4ab]'}>{adventureAttempts}</span> chances
            </span>
          </div>
        </div>
      ) : (
        <div className="surface-card rounded-2xl w-full max-w-sm h-36 animate-pulse" />
      )}

      {/* Botones de modo */}
      <div className="flex flex-col gap-3 w-full max-w-sm">
        <button
          onClick={() => onPlay('sim')}
          disabled={simAttempts === 0}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all electric-glow disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          ⚡ Simulación
        </button>
        <button
          onClick={() => onPlay('adventure')}
          disabled={adventureAttempts === 0}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#75ff9e', color: '#003918' }}
        >
          🎮 Aventura
        </button>
        <button
          onClick={() => onPlay('multiplayer')}
          className="w-full font-bold py-4 rounded-xl text-body-lg transition-all"
          style={{ background: '#1d2025', border: '1px solid #75ff9e', color: '#75ff9e' }}
        >
          🤝 Multijugador
        </button>
      </div>

      <p className="text-label-caps text-[#859585] capitalize">{today}</p>
    </main>

    <footer className="shrink-0 py-4 flex flex-col items-center gap-2">
      <button
        onClick={onResetAttempts}
        className="text-label-caps text-[#3b4a3d] hover:text-[#859585] transition-colors underline underline-offset-2"
      >
        [dev] renovar chances
      </button>
      <p className="text-label-caps text-[#3b4a3d]">Fantasy LPF · La Fecha · {new Date().getFullYear()}</p>
    </footer>
    </div>
  )
}
