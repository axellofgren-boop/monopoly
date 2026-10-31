/**
 * Autopilot for players who disconnected (rulebook: "it never buys or builds, and pays debts by
 * mortgaging the cheapest property first"). Returns the next action to send, or null if the
 * autopilot has nothing to do right now.
 */
import { spaceAt, isOwnable } from './board.js';
import { buildLevel, getProperty, groupHasBuildings, propertiesOf } from './rules.js';
import type { Action, GameState, PlayerId } from './types.js';

type Intent = Action extends infer A ? (A extends { player: PlayerId } ? A : never) : never;

export function autopilotAction(state: GameState, id: PlayerId, now: number): Intent | null {
  const me = state.players.find((p) => p.id === id);
  if (!me || me.bankrupt) return null;
  const ph = state.phase;

  if (ph.kind === 'crisis') {
    if (ph.debtor !== id) return null;
    const owned = propertiesOf(state, id);
    const price = (i: number) => {
      const s = spaceAt(i);
      return isOwnable(s) ? s.price : 0;
    };
    const mortgageable = owned
      .filter((i) => !getProperty(state, i).mortgaged && !groupHasBuildings(state, i))
      .sort((a, b) => price(a) - price(b));
    const first = mortgageable[0];
    if (first !== undefined) return { type: 'MORTGAGE', player: id, now, space: first };
    const built = owned
      .filter((i) => buildLevel(getProperty(state, i)) > 0)
      .sort((a, b) => buildLevel(getProperty(state, b)) - buildLevel(getProperty(state, a)));
    const sell = built[0];
    if (sell !== undefined) return { type: 'SELL_BUILDING', player: id, now, space: sell };
    return { type: 'DECLARE_BANKRUPTCY', player: id, now };
  }

  if (state.turn.current !== id) return null;
  if (me.pendingItem) return { type: 'DISCARD_ITEM', player: id, now, item: me.pendingItem };
  switch (ph.kind) {
    case 'awaitingRoll':
      return { type: 'ROLL', player: id, now };
    case 'chooseDice':
      return { type: 'CHOOSE_DICE', player: id, now, keep: [0, 1] };
    case 'adjustMove':
      return { type: 'ADJUST_MOVE', player: id, now, reduceBy: 0 };
    case 'awaitingBuyDecision':
      return { type: 'DECLINE_BUY', player: id, now };
    case 'rentChoice':
      return { type: 'PAY_RENT', player: id, now };
    case 'ohopp':
      return { type: 'STAY', player: id, now };
    case 'turnEnd':
      return { type: 'END_TURN', player: id, now };
    default:
      return null;
  }
}
