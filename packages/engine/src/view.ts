import type { GameState } from './types.js';

/**
 * What clients may see. The card order and RNG seed would let a player predict the future,
 * so they are replaced by the deck size.
 */
export type PublicState = Omit<GameState, 'seed' | 'deck'> & { deckSize: number };

export function publicView(state: GameState): PublicState {
  const { seed: _seed, deck, ...rest } = state;
  return { ...rest, deckSize: deck.length };
}
