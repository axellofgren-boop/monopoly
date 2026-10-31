/**
 * Messages between the browser and the game server, sent as JSON over a WebSocket.
 * The server is authoritative: clients send intents, the server stamps who and when,
 * runs the engine and broadcasts the public state.
 */
import type { Action, GameEvent, PlayerId, PublicState } from '@hometown/engine';

/** Tokens a player can pick in the lobby. */
export const TOKENS = ['dalahast', 'kanelbulle', 'alg', 'vasaskepp', 'viking', 'fika'] as const;
export type Token = (typeof TOKENS)[number];

/**
 * An engine action as a client may send it: no player (the server knows who you are),
 * no time (the server's clock decides) and no forced dice.
 */
export type Intent = Action extends infer A
  ? A extends { player: PlayerId }
    ? Omit<A, 'player' | 'now' | 'dice'>
    : never
  : never;

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  token: Token;
  connected: boolean;
  host: boolean;
}

type Vec3 = [number, number, number];

/**
 * How the dice were thrown: where they were let go, how fast and how they spun. Every client
 * replays the same throw with physics; the server alone decides the values shown on top.
 */
export interface DiceThrow {
  origin: Vec3;
  velocity: Vec3;
  /** Angular velocity per die. */
  spin: Vec3[];
}

/** Where a player's camera is and where it looks, shown to others as a floating avatar. */
export interface CameraPose {
  p: Vec3;
  yaw: number;
  pitch: number;
}

/** World limits for camera flying and dice throws (the board is 10 x 10 at the origin). */
export const WORLD_RADIUS = 26;
export const WORLD_CEILING = 18;
export const THROW_SPEED_MAX = 14;
export const THROW_SPIN_MAX = 30;

const clampNum = (v: unknown, lo: number, hi: number, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const vec = (v: unknown, lo: number, hi: number): Vec3 => {
  const a = Array.isArray(v) ? v : [];
  return [clampNum(a[0], lo, hi), clampNum(a[1], lo, hi), clampNum(a[2], lo, hi)];
};

/** Clamps an untrusted throw to sane limits. Returns null if it isn't a throw at all. */
export function sanitizeThrow(raw: unknown, dice: number): DiceThrow | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const spins = Array.isArray(t.spin) ? t.spin : [];
  const origin = vec(t.origin, -WORLD_RADIUS, WORLD_RADIUS);
  origin[1] = Math.min(Math.max(origin[1], 0.5), 4);
  return {
    origin,
    velocity: vec(t.velocity, -THROW_SPEED_MAX, THROW_SPEED_MAX),
    spin: Array.from({ length: dice }, (_, i) => vec(spins[i], -THROW_SPIN_MAX, THROW_SPIN_MAX)),
  };
}

/** A throw for when nobody picked the dice up (the Roll button, or the autopilot). */
export function randomThrow(dice: number, random: () => number = Math.random): DiceThrow {
  const r = (a: number, b: number) => a + random() * (b - a);
  const angle = r(-0.6, 0.6);
  return {
    origin: [r(6.2, 7.2), r(1.4, 2), r(2.2, 4)],
    velocity: [-Math.cos(angle) * r(3, 5), r(0.5, 2), -Math.sin(angle) * r(3, 5) - 1],
    spin: Array.from({ length: dice }, () => [r(-20, 20), r(-20, 20), r(-20, 20)] as Vec3),
  };
}

/** Clamps an untrusted camera pose. Returns null if it isn't a pose. */
export function sanitizePose(raw: unknown): CameraPose | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const p = vec(c.p, -WORLD_RADIUS, WORLD_RADIUS);
  p[1] = Math.min(Math.max(p[1], -1), WORLD_CEILING);
  return { p, yaw: clampNum(c.yaw, -1e4, 1e4), pitch: clampNum(c.pitch, -1.6, 1.6) };
}

export type ClientMessage =
  | { type: 'create'; name: string; token: Token }
  | { type: 'join'; code: string; name: string; token: Token }
  | { type: 'rejoin'; code: string; playerId: PlayerId; secret: string }
  | { type: 'start' }
  | { type: 'intent'; intent: Intent; diceThrow?: DiceThrow }
  | { type: 'minigameScore'; score: number }
  | { type: 'camera'; pose: CameraPose };

export type ServerMessage =
  | { type: 'welcome'; code: string; playerId: PlayerId; secret: string }
  | { type: 'lobby'; code: string; players: LobbyPlayer[] }
  | {
      type: 'state';
      state: PublicState;
      events: GameEvent[];
      players: LobbyPlayer[];
      serverNow: number;
      /** Present when these events include a dice roll. */
      diceThrow?: DiceThrow;
    }
  | { type: 'cameras'; poses: Record<PlayerId, CameraPose> }
  | { type: 'error'; message: string };

export const ROOM_CODE_LENGTH = 5;
export const NAME_MAX_LENGTH = 16;
