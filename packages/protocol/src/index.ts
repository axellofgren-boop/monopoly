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

export type ClientMessage =
  | { type: 'create'; name: string; token: Token }
  | { type: 'join'; code: string; name: string; token: Token }
  | { type: 'rejoin'; code: string; playerId: PlayerId; secret: string }
  | { type: 'start' }
  | { type: 'intent'; intent: Intent }
  | { type: 'minigameScore'; score: number };

export type ServerMessage =
  | { type: 'welcome'; code: string; playerId: PlayerId; secret: string }
  | { type: 'lobby'; code: string; players: LobbyPlayer[] }
  | {
      type: 'state';
      state: PublicState;
      events: GameEvent[];
      players: LobbyPlayer[];
      serverNow: number;
    }
  | { type: 'error'; message: string };

export const ROOM_CODE_LENGTH = 5;
export const NAME_MAX_LENGTH = 16;
