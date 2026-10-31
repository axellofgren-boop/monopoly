/**
 * Hometown game server: serves the built web client and runs game rooms over WebSockets
 * at /ws. Start with `npm run dev` (watch mode) or `npm start`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@hometown/protocol';
import { RoomError, checkToken, cleanName } from './room.js';
import type { Room } from './room.js';
import { RoomRegistry } from './rooms.js';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 250;
const MAX_MESSAGE_BYTES = 8 * 1024;
const WEB_DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const registry = new RoomRegistry();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: registry.size }));
    return;
  }
  // Serve the built client; unknown paths fall back to index.html (rooms live at /?room=CODE).
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
  let file = join(WEB_DIST, path);
  if (!file.startsWith(WEB_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(WEB_DIST, 'index.html');
  }
  if (!existsSync(file)) {
    res.writeHead(404).end('Client not built. Run `npm run build` or use `npm run dev`.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (socket: WebSocket) => {
  let room: Room | null = null;
  let playerId: string | null = null;
  const send = (msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  socket.on('message', (raw) => {
    const now = Date.now();
    try {
      const msg = JSON.parse(String(raw)) as ClientMessage;
      switch (msg.type) {
        case 'create': {
          if (room) throw new RoomError('Already in a room');
          room = registry.create(now);
          playerId = room.join(cleanName(msg.name), checkToken(msg.token), send, now).id;
          return;
        }
        case 'join': {
          if (room) throw new RoomError('Already in a room');
          const found = registry.get(String(msg.code));
          if (!found) throw new RoomError('No game with that code');
          playerId = found.join(cleanName(msg.name), checkToken(msg.token), send, now).id;
          room = found;
          return;
        }
        case 'rejoin': {
          const found = registry.get(String(msg.code));
          if (!found) throw new RoomError('That game has ended');
          playerId = found.rejoin(String(msg.playerId), String(msg.secret), send, now).id;
          room = found;
          return;
        }
      }
      if (!room || !playerId) throw new RoomError('Join a game first');
      switch (msg.type) {
        case 'start':
          return room.start(playerId, now);
        case 'intent':
          return room.intent(playerId, msg.intent, now, msg.diceThrow);
        case 'minigameScore':
          return room.minigameScore(playerId, Number(msg.score));
        case 'camera':
          return room.camera(playerId, msg.pose);
      }
    } catch (err) {
      send({ type: 'error', message: err instanceof RoomError ? err.message : 'Bad message' });
      if (!(err instanceof RoomError)) console.warn('Bad message', err);
    }
  });

  socket.on('close', () => {
    if (room && playerId) room.disconnect(playerId, Date.now());
  });
});

setInterval(() => registry.tick(Date.now()), TICK_MS);

http.listen(PORT, () => console.info(`Hometown server on http://localhost:${PORT}`));
