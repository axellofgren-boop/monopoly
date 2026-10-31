/**
 * Core types for the Hometown rules engine.
 *
 * The engine is a pure, deterministic reducer: `applyAction(state, action)` returns a new state
 * plus a list of events. It never reads the clock or Math.random; time arrives on each action as
 * `now` (milliseconds) and randomness comes from the seeded RNG stored in the state.
 */

export type PlayerId = string;

export type ItemKind =
  | 'dubbeltarning' // roll three dice, keep two
  | 'slkort' // move to the next T-station instead of rolling
  | 'hyresfrihet' // cancel one rent payment
  | 'advokat' // leave Arresten for free
  | 'snoplog' // after rolling, move up to 3 spaces fewer
  | 'byggrabatt'; // next house costs half

export interface Player {
  id: PlayerId;
  name: string;
  token: string;
  cash: number;
  position: number;
  items: ItemKind[];
  /** Set when a fourth item arrived; the player must discard one before continuing. */
  pendingItem: ItemKind | null;
  inJail: boolean;
  jailAttempts: number;
  bankrupt: boolean;
  /** Number of trade offers sent during the current turn. */
  offersThisTurn: number;
}

export interface PropertyState {
  owner: PlayerId | null;
  houses: number; // 0..3
  landmark: boolean;
  mortgaged: boolean;
}

export interface TradeSide {
  cash: number;
  spaces: number[];
  items: ItemKind[];
}

export interface TradeOffer {
  id: number;
  from: PlayerId;
  to: PlayerId;
  give: TradeSide;
  get: TradeSide;
  expiresAt: number;
}

export type Creditor = PlayerId | 'bank';

/** What the game is waiting for. Exactly one phase is active at a time. */
export type Phase =
  | { kind: 'awaitingRoll' }
  | { kind: 'chooseDice'; dice: [number, number, number] }
  | { kind: 'adjustMove'; dice: [number, number] }
  | { kind: 'awaitingBuyDecision'; space: number }
  | { kind: 'rentChoice'; space: number; amount: number; owner: PlayerId }
  | { kind: 'ohopp' }
  | {
      kind: 'minigame';
      reason: 'space' | 'roundFinal';
      players: PlayerId[];
      endsAt: number;
    }
  | {
      kind: 'crisis';
      debtor: PlayerId;
      creditor: Creditor;
      amount: number;
      endsAt: number;
    }
  | { kind: 'turnEnd' }
  | { kind: 'gameOver'; winners: PlayerId[]; reason: 'lastStanding' | 'backstop' };

export interface TurnState {
  current: PlayerId;
  doublesInRow: number;
  /** True when the last roll was a double and the player rolls again after resolving. */
  rollAgain: boolean;
  lastDice: number[] | null;
  /** Deadline for the current player's decision in the active phase. */
  deadline: number;
}

export interface GameConfig {
  startingCash: number;
  passStart: number;
  landOnStart: number;
  rushHourPassStart: number;
  jailFine: number;
  ohoppFee: number;
  turnSeconds: number;
  crisisSeconds: number;
  tradeSeconds: number;
  minigameSeconds: number;
  rushHourMinutes: number;
  rushHourRound: number;
  backstopMinutes: number;
  roundFinalEvery: number;
  maxItems: number;
  maxOffersPerTurn: number;
  bankHouses: number;
  bankLandmarks: number;
}

export interface GameState {
  config: GameConfig;
  seed: number;
  startedAt: number;
  round: number;
  /** Seat order; bankrupt players stay in the list but are skipped. */
  players: Player[];
  properties: Record<number, PropertyState>;
  bank: { houses: number; landmarks: number };
  deck: number[];
  trades: TradeOffer[];
  nextTradeId: number;
  turn: TurnState;
  phase: Phase;
  /** What happens once an interrupting phase (crisis, minigame) is resolved. */
  resume: Continuation | null;
  rushHourAnnounced: boolean;
}

export type Continuation =
  | { kind: 'continueTurn' }
  | { kind: 'move'; steps: number }
  | { kind: 'startTurn'; player: PlayerId };

export type Action =
  | { type: 'ROLL'; player: PlayerId; now: number; useItem?: 'dubbeltarning'; dice?: number[] }
  | { type: 'CHOOSE_DICE'; player: PlayerId; now: number; keep: [number, number] }
  | { type: 'ADJUST_MOVE'; player: PlayerId; now: number; reduceBy: number }
  | { type: 'BUY'; player: PlayerId; now: number }
  | { type: 'DECLINE_BUY'; player: PlayerId; now: number }
  | { type: 'PAY_RENT'; player: PlayerId; now: number }
  | { type: 'PAY_JAIL_FINE'; player: PlayerId; now: number }
  | { type: 'USE_ITEM'; player: PlayerId; now: number; item: 'slkort' | 'advokat' | 'hyresfrihet' }
  | { type: 'DISCARD_ITEM'; player: PlayerId; now: number; item: ItemKind }
  | { type: 'HOP'; player: PlayerId; now: number; to: number }
  | { type: 'STAY'; player: PlayerId; now: number }
  | { type: 'BUILD'; player: PlayerId; now: number; space: number }
  | { type: 'SELL_BUILDING'; player: PlayerId; now: number; space: number }
  | { type: 'MORTGAGE'; player: PlayerId; now: number; space: number }
  | { type: 'UNMORTGAGE'; player: PlayerId; now: number; space: number }
  | {
      type: 'PROPOSE_TRADE';
      player: PlayerId;
      now: number;
      to: PlayerId;
      give: TradeSide;
      get: TradeSide;
    }
  | {
      type: 'RESPOND_TRADE';
      player: PlayerId;
      now: number;
      tradeId: number;
      response: 'accept' | 'decline' | 'counter';
      /** Required for a counter: the new terms, from the responder's side. */
      counter?: { give: TradeSide; get: TradeSide };
    }
  | { type: 'DECLARE_BANKRUPTCY'; player: PlayerId; now: number }
  | { type: 'END_TURN'; player: PlayerId; now: number }
  /** Sent by the server with minigame scores (higher is better). */
  | { type: 'MINIGAME_RESULT'; now: number; scores: Record<PlayerId, number> }
  /** Sent by the server on a timer; resolves expired deadlines. */
  | { type: 'TICK'; now: number };

export type GameEvent =
  | { type: 'rolled'; player: PlayerId; dice: number[] }
  | { type: 'moved'; player: PlayerId; from: number; to: number; passedStart: boolean }
  | { type: 'paid'; from: Creditor; to: Creditor; amount: number; reason: string }
  | { type: 'bought'; player: PlayerId; space: number; price: number }
  | { type: 'declinedBuy'; player: PlayerId; space: number }
  | { type: 'card'; player: PlayerId; card: string }
  | { type: 'item'; player: PlayerId; item: ItemKind; gained: boolean }
  | { type: 'jailed'; player: PlayerId }
  | { type: 'released'; player: PlayerId }
  | { type: 'built'; player: PlayerId; space: number; landmark: boolean }
  | { type: 'sold'; player: PlayerId; space: number; refund: number }
  | { type: 'mortgaged'; player: PlayerId; space: number; unmortgaged: boolean }
  | { type: 'tradeProposed'; trade: TradeOffer }
  | {
      type: 'tradeResolved';
      tradeId: number;
      outcome: 'accepted' | 'declined' | 'countered' | 'expired';
    }
  | { type: 'minigameStarted'; reason: 'space' | 'roundFinal' }
  | { type: 'minigameResult'; ranking: PlayerId[][] }
  | { type: 'crisis'; player: PlayerId; amount: number }
  | { type: 'bankrupt'; player: PlayerId; creditor: Creditor }
  | { type: 'turnStarted'; player: PlayerId; round: number }
  | { type: 'rushHour' }
  | { type: 'gameOver'; winners: PlayerId[] };

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };
