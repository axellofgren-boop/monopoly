import { OWNABLE_INDICES } from './board.js';
import { CARDS } from './cards.js';
import { DEFAULT_CONFIG, MAX_PLAYERS, MIN_PLAYERS } from './config.js';
import { Rng } from './rng.js';
import type { GameConfig, GameState, Player, PlayerId, PropertyState } from './types.js';

export interface NewPlayer {
  id: PlayerId;
  name: string;
  token: string;
}

export interface NewGameOptions {
  players: NewPlayer[];
  seed: number;
  now: number;
  config?: Partial<GameConfig>;
  /** Keep the given seat order instead of shuffling (useful in tests). */
  keepOrder?: boolean;
}

export function createGame(opts: NewGameOptions): GameState {
  const { players, seed, now } = opts;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`A game needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error('Player ids must be unique');
  }
  const config: GameConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const rng = new Rng(seed);
  const order = opts.keepOrder ? players : rng.shuffle(players);
  const seats: Player[] = order.map((p) => ({
    ...p,
    cash: config.startingCash,
    position: 0,
    items: [],
    pendingItem: null,
    inJail: false,
    jailAttempts: 0,
    bankrupt: false,
    offersThisTurn: 0,
  }));
  const properties: Record<number, PropertyState> = {};
  for (const i of OWNABLE_INDICES) {
    properties[i] = { owner: null, houses: 0, landmark: false, mortgaged: false };
  }
  const first = seats[0];
  if (!first) throw new Error('No players');
  return {
    config,
    seed: rng.seed,
    startedAt: now,
    round: 1,
    players: seats,
    properties,
    bank: { houses: config.bankHouses, landmarks: config.bankLandmarks },
    deck: rng.shuffle(CARDS.map((_, i) => i)),
    trades: [],
    nextTradeId: 1,
    turn: {
      current: first.id,
      doublesInRow: 0,
      rollAgain: false,
      lastDice: null,
      deadline: now + config.turnSeconds * 1000,
    },
    phase: { kind: 'awaitingRoll' },
    resume: null,
    rushHourAnnounced: false,
  };
}
