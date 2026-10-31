/**
 * A game room: lobby, authoritative game state, timers, minigame score collection and
 * autopilot for players who dropped out. Transport-agnostic: each player has a `send`
 * callback, so rooms can be tested without sockets.
 */
import { randomUUID } from 'node:crypto';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyAction,
  autopilotAction,
  createGame,
  publicView,
} from '@hometown/engine';
import type { Action, GameEvent, GameState, PlayerId } from '@hometown/engine';
import {
  NAME_MAX_LENGTH,
  TOKENS,
  randomThrow,
  sanitizePose,
  sanitizeThrow,
} from '@hometown/protocol';
import type {
  CameraPose,
  DiceThrow,
  Intent,
  LobbyPlayer,
  ServerMessage,
  Token,
} from '@hometown/protocol';

/** A disconnected player is handed to the autopilot after this long. */
export const AWAY_AFTER_MS = 2 * 60_000;
/** Clients play a minigame for this long; the server waits a little longer for scores. */
export const MINIGAME_PLAY_MS = 10_000;
export const MINIGAME_GRACE_MS = 3_000;

type Send = (msg: ServerMessage) => void;

interface Seat {
  id: PlayerId;
  name: string;
  token: Token;
  secret: string;
  host: boolean;
  send: Send | null;
  disconnectedAt: number | null;
}

export class RoomError extends Error {}

export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new RoomError('Pick a name');
  return name.slice(0, NAME_MAX_LENGTH);
}

export function checkToken(raw: unknown): Token {
  if (!TOKENS.includes(raw as Token)) throw new RoomError('Unknown token');
  return raw as Token;
}

export class Room {
  private readonly seats: Seat[] = [];
  private game: GameState | null = null;
  private scores = new Map<PlayerId, number>();
  private minigameStartedAt: number | null = null;
  private poses = new Map<PlayerId, CameraPose>();
  private posesDirty = false;
  /** Throw supplied with the action being applied, if any. */
  private pendingThrow: unknown = null;
  lastActivity: number;

  constructor(
    readonly code: string,
    private readonly seed: number,
    now: number,
  ) {
    this.lastActivity = now;
  }

  get started(): boolean {
    return this.game !== null;
  }

  get connectedCount(): number {
    return this.seats.filter((s) => s.send).length;
  }

  join(name: string, token: Token, send: Send, now: number): Seat {
    if (this.game) throw new RoomError('This game has already started');
    if (this.seats.length >= MAX_PLAYERS) throw new RoomError('This room is full');
    // Joiners can't see the lobby before joining, so a taken token is swapped for a free one.
    const taken = new Set(this.seats.map((s) => s.token));
    const finalToken = taken.has(token) ? TOKENS.find((t) => !taken.has(t)) : token;
    if (!finalToken) throw new RoomError('No tokens left');
    const seat: Seat = {
      id: randomUUID().slice(0, 8),
      name,
      token: finalToken,
      secret: randomUUID(),
      host: this.seats.length === 0,
      send,
      disconnectedAt: null,
    };
    this.seats.push(seat);
    this.lastActivity = now;
    send({ type: 'welcome', code: this.code, playerId: seat.id, secret: seat.secret });
    this.broadcast();
    return seat;
  }

  rejoin(playerId: PlayerId, secret: string, send: Send, now: number): Seat {
    const seat = this.seats.find((s) => s.id === playerId && s.secret === secret);
    if (!seat) throw new RoomError('Could not rejoin this game');
    seat.send = send;
    seat.disconnectedAt = null;
    this.lastActivity = now;
    send({ type: 'welcome', code: this.code, playerId: seat.id, secret: seat.secret });
    this.broadcast();
    return seat;
  }

  disconnect(playerId: PlayerId, now: number): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    seat.send = null;
    seat.disconnectedAt = now;
    if (this.poses.delete(playerId)) this.posesDirty = true;
    this.broadcast();
  }

  start(playerId: PlayerId, now: number): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat?.host) throw new RoomError('Only the host can start the game');
    if (this.game) throw new RoomError('The game has already started');
    if (this.seats.length < MIN_PLAYERS)
      throw new RoomError(`Wait for at least ${MIN_PLAYERS} players`);
    this.game = createGame({
      players: this.seats.map(({ id, name, token }) => ({ id, name, token })),
      seed: this.seed,
      now,
    });
    this.lastActivity = now;
    this.broadcast([]);
  }

  intent(playerId: PlayerId, intent: Intent, now: number, diceThrow?: unknown): void {
    if (!this.game) throw new RoomError('The game has not started');
    // Rebuild the action so a client can never set the player, the time or forced dice.
    const { dice: _dice, ...clean } = intent as Intent & { dice?: unknown };
    this.pendingThrow = diceThrow ?? null;
    try {
      this.apply({ ...clean, player: playerId, now } as Action);
    } finally {
      this.pendingThrow = null;
    }
    this.lastActivity = now;
  }

  /** Stores where a player is looking; sent to everyone on the next tick. */
  camera(playerId: PlayerId, raw: unknown): void {
    if (!this.game) return;
    const pose = sanitizePose(raw);
    if (!pose || !this.seats.some((s) => s.id === playerId)) return;
    this.poses.set(playerId, pose);
    this.posesDirty = true;
  }

  minigameScore(playerId: PlayerId, score: number): void {
    if (this.game?.phase.kind !== 'minigame') return;
    if (!this.game.phase.players.includes(playerId)) return;
    if (!Number.isFinite(score) || score < 0) return;
    this.scores.set(playerId, Math.min(Math.floor(score), 10_000));
  }

  /** Called on a timer by the server. */
  tick(now: number): void {
    if (this.posesDirty) {
      this.posesDirty = false;
      const msg: ServerMessage = { type: 'cameras', poses: Object.fromEntries(this.poses) };
      for (const seat of this.seats) seat.send?.(msg);
    }
    const game = this.game;
    if (!game || game.phase.kind === 'gameOver') return;

    if (game.phase.kind === 'minigame') {
      const ph = game.phase;
      const allIn = ph.players.every((id: string) => this.scores.has(id) || this.isAway(id, now));
      const started = this.minigameStartedAt ?? now;
      if (allIn || now >= started + MINIGAME_PLAY_MS + MINIGAME_GRACE_MS) {
        this.apply({ type: 'MINIGAME_RESULT', now, scores: Object.fromEntries(this.scores) });
      }
      return;
    }

    for (const seat of this.seats) {
      if (!this.isAway(seat.id, now)) continue;
      const action = autopilotAction(this.game as GameState, seat.id, now);
      if (action) {
        this.apply(action);
        return; // one autopilot step per tick keeps the game watchable
      }
    }
    this.apply({ type: 'TICK', now });
  }

  private isAway(id: PlayerId, now: number): boolean {
    const seat = this.seats.find((s) => s.id === id);
    return !!seat && seat.disconnectedAt !== null && now - seat.disconnectedAt >= AWAY_AFTER_MS;
  }

  private apply(action: Action): void {
    if (!this.game) return;
    const result = applyAction(this.game, action);
    if (!result.ok) {
      if ('player' in action) this.sendTo(action.player, { type: 'error', message: result.error });
      return;
    }
    const before = this.game.phase.kind;
    this.game = result.state;
    if (this.game.phase.kind === 'minigame' && before !== 'minigame') {
      this.scores = new Map();
      this.minigameStartedAt = action.now;
    }
    if (result.events.length || before !== this.game.phase.kind || action.type !== 'TICK') {
      this.broadcast(result.events, this.throwFor(result.events));
    }
  }

  /** The throw to animate if these events include a roll: the player's own, or a random one. */
  private throwFor(events: GameEvent[]): DiceThrow | undefined {
    const roll = events.find((e) => e.type === 'rolled');
    if (!roll || roll.type !== 'rolled') return undefined;
    return sanitizeThrow(this.pendingThrow, roll.dice.length) ?? randomThrow(roll.dice.length);
  }

  lobbyPlayers(): LobbyPlayer[] {
    return this.seats.map((s) => ({
      id: s.id,
      name: s.name,
      token: s.token,
      connected: s.send !== null,
      host: s.host,
    }));
  }

  private sendTo(id: PlayerId, msg: ServerMessage): void {
    this.seats.find((s) => s.id === id)?.send?.(msg);
  }

  private broadcast(events: GameEvent[] = [], diceThrow?: DiceThrow): void {
    const players = this.lobbyPlayers();
    const msg: ServerMessage = this.game
      ? {
          type: 'state',
          state: publicView(this.game),
          events,
          players,
          serverNow: Date.now(),
          ...(diceThrow ? { diceThrow } : {}),
        }
      : { type: 'lobby', code: this.code, players };
    for (const seat of this.seats) seat.send?.(msg);
  }
}
