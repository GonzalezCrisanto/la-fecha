const http = require('http')
const { WebSocketServer } = require('ws')

const PORT = process.env.PORT || 8080
const ROOM_TTL_MS = 30 * 60 * 1000

const rooms = new Map()

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateCode() {
  let code
  do {
    code = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('')
  } while (rooms.has(code))
  return code
}

function send(ws, payload) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(payload))
}

const server = http.createServer((req, res) => {
  res.writeHead(200)
  res.end('ok')
})

const wss = new WebSocketServer({ server })

server.listen(PORT, () => console.log(`WS server running on port ${PORT}`))

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return }
    ws.isAlive = false
    ws.ping()
  })
}, 30_000)

wss.on('close', () => clearInterval(heartbeat))

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.roomCode = null
  ws.role = null

  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.type === 'create') {
      const code = generateCode()
      rooms.set(code, { code, home: ws, away: null, homeSquad: null, awaySquad: null, createdAt: Date.now() })
      ws.roomCode = code
      ws.role = 'home'
      send(ws, { type: 'created', code, role: 'home' })
    }

    else if (msg.type === 'join') {
      const code = (msg.code ?? '').toUpperCase()
      const room = rooms.get(code)
      if (!room) return send(ws, { type: 'error', message: 'Sala no encontrada' })
      if (room.away) return send(ws, { type: 'error', message: 'Sala llena' })
      room.away = ws
      ws.roomCode = code
      ws.role = 'away'
      send(ws, { type: 'joined', code, role: 'away' })
      send(room.home, { type: 'opponent_joined' })
    }

    else if (msg.type === 'squad') {
      const room = rooms.get(ws.roomCode)
      if (!room) return
      const data = { squad: msg.squad, formation: msg.formation, strategy: msg.strategy }
      if (ws.role === 'home') room.homeSquad = data
      else room.awaySquad = data

      if (room.homeSquad && room.awaySquad) {
        const seed = Math.floor(Math.random() * 2_000_000)
        const payload = { type: 'start', seed, home: room.homeSquad, away: room.awaySquad }
        send(room.home, payload)
        send(room.away, payload)
        setTimeout(() => rooms.delete(room.code), 20 * 60 * 1000)
      }
    }

    else if (msg.type === 'halftime_strategy') {
      const room = rooms.get(ws.roomCode)
      if (!room) return
      if (ws.role === 'home') room.homeHalftimeStrategy = msg.strategy
      else room.awayHalftimeStrategy = msg.strategy

      if (room.homeHalftimeStrategy && room.awayHalftimeStrategy) {
        const payload = {
          type: 'second_half_go',
          homeStrategy: room.homeHalftimeStrategy,
          awayStrategy: room.awayHalftimeStrategy,
        }
        send(room.home, payload)
        send(room.away, payload)
        room.homeHalftimeStrategy = null
        room.awayHalftimeStrategy = null
      }
    }

    else if (msg.type === 'ping') {
      send(ws, { type: 'pong' })
    }
  })

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode)
    if (!room) return
    const other = ws.role === 'home' ? room.away : room.home
    send(other, { type: 'opponent_left' })
    rooms.delete(ws.roomCode)
  })
})

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) rooms.delete(code)
  }
}, 10 * 60 * 1000)
