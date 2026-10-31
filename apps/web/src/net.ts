/** WebSocket connection with automatic reconnect and rejoin. */
import type { ClientMessage, ServerMessage } from '@hometown/protocol';

const SESSION_KEY = 'hometown.session';

export interface Session {
  code: string;
  playerId: string;
  secret: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable (private mode); the game still works without rejoin.
  }
}

export class Connection {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private retry = 0;

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {
    this.open();
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
      const session = loadSession();
      if (session) this.send({ type: 'rejoin', ...session });
      for (const msg of this.queue.splice(0)) this.send(msg);
    };
    socket.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
    socket.onclose = () => {
      this.onStatus(false);
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }
}
