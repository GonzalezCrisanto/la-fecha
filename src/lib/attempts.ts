const MAX = 3

function key(mode: 'sim' | 'adventure'): string {
  const date = new Date().toISOString().slice(0, 10)
  return `la-fecha-attempts-${mode}-${date}`
}

export function getRemainingAttempts(mode: 'sim' | 'adventure'): number {
  const raw = localStorage.getItem(key(mode))
  const used = raw ? parseInt(raw, 10) : 0
  return Math.max(0, MAX - used)
}

export function consumeAttempt(mode: 'sim' | 'adventure'): void {
  const raw = localStorage.getItem(key(mode))
  const used = raw ? parseInt(raw, 10) : 0
  localStorage.setItem(key(mode), String(used + 1))
}

export function resetAttempts(): void {
  localStorage.removeItem(key('sim'))
  localStorage.removeItem(key('adventure'))
}
