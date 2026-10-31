import type { GameConfig } from './types.js';

/** Defaults from rulebook draft 1. Amounts in kr, durations in seconds or minutes as named. */
export const DEFAULT_CONFIG: GameConfig = {
  startingCash: 2500,
  passStart: 250,
  landOnStart: 400,
  rushHourPassStart: 100,
  jailFine: 100,
  ohoppFee: 100,
  turnSeconds: 60,
  auctionOpenSeconds: 15,
  auctionBidSeconds: 5,
  crisisSeconds: 60,
  tradeSeconds: 30,
  minigameSeconds: 30,
  rushHourMinutes: 45,
  rushHourRound: 15,
  backstopMinutes: 75,
  roundFinalEvery: 5,
  maxItems: 3,
  maxOffersPerTurn: 3,
  bankHouses: 30,
  bankLandmarks: 10,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
