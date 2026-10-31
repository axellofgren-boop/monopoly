import { expect } from 'vitest';
import { applyAction, createGame } from '../src/index.js';
import type { Action, GameEvent, GameState, Player, PlayerId } from '../src/index.js';

export const T0 = 1_000_000;

/** A fresh 2- or 3-player game with fixed seat order: ann, bo, (cy). */
export function newGame(count = 2, overrides: Partial<GameState['config']> = {}): GameState {
  const all = [
    { id: 'ann', name: 'Ann', token: 'dalahast' },
    { id: 'bo', name: 'Bo', token: 'alg' },
    { id: 'cy', name: 'Cy', token: 'kanelbulle' },
  ];
  return createGame({
    players: all.slice(0, count),
    seed: 42,
    now: T0,
    keepOrder: true,
    config: overrides,
  });
}

type ActionInput = Action extends infer A
  ? A extends Action
    ? Omit<A, 'now'> & { now?: number }
    : never
  : never;

/** Applies an action that must succeed; returns the new state and its events. */
export function act(
  state: GameState,
  action: ActionInput,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, { now: T0, ...action } as Action);
  if (!result.ok) throw new Error(`Expected ${action.type} to succeed: ${result.error}`);
  return { state: result.state, events: result.events };
}

/** Applies an action that must be refused; returns the error message. */
export function refused(state: GameState, action: ActionInput): string {
  const result = applyAction(state, { now: T0, ...action } as Action);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
}

export function player(state: GameState, id: PlayerId): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

/** Returns a modified copy of the state, for setting up scenarios. */
export function edit(state: GameState, fn: (draft: GameState) => void): GameState {
  const draft = JSON.parse(JSON.stringify(state)) as GameState;
  fn(draft);
  return draft;
}

export function own(state: GameState, id: PlayerId, ...spaces: number[]): GameState {
  return edit(state, (d) => {
    for (const s of spaces) {
      const prop = d.properties[s];
      if (prop) prop.owner = id;
    }
  });
}

/** Rolls fixed dice for the current player. */
export function roll(state: GameState, a: number, b: number) {
  return act(state, { type: 'ROLL', player: state.turn.current, dice: [a, b] });
}
