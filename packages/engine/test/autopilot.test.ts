import { describe, expect, it } from 'vitest';
import { autopilotAction, publicView } from '../src/index.js';
import { T0, act, edit, newGame, own, roll } from './helpers.js';

describe('autopilot', () => {
  it('rolls, declines purchases and ends the turn', () => {
    let s = newGame();
    expect(autopilotAction(s, 'ann', T0)).toMatchObject({ type: 'ROLL' });
    expect(autopilotAction(s, 'bo', T0)).toBeNull();
    s = roll(s, 1, 2).state;
    expect(autopilotAction(s, 'ann', T0)).toMatchObject({ type: 'DECLINE_BUY' });
  });

  it('mortgages the cheapest property first in a crisis', () => {
    let s = edit(own(own(newGame(), 'bo', 3), 'ann', 39, 1), (d) => {
      d.players[0]!.cash = 5;
    });
    s = roll(s, 1, 2).state;
    expect(autopilotAction(s, 'ann', T0)).toMatchObject({ type: 'MORTGAGE', space: 1 });
  });

  it('declares bankruptcy when nothing is left to sell', () => {
    let s = edit(own(newGame(), 'bo', 3), (d) => {
      d.players[0]!.cash = 5;
    });
    s = roll(s, 1, 2).state;
    const a = autopilotAction(s, 'ann', T0);
    expect(a).toMatchObject({ type: 'DECLARE_BANKRUPTCY' });
    s = act(s, a!).state;
    expect(s.phase.kind).toBe('gameOver');
  });
});

describe('publicView', () => {
  it('hides the deck order and seed', () => {
    const v = publicView(newGame()) as Record<string, unknown>;
    expect(v.deck).toBeUndefined();
    expect(v.seed).toBeUndefined();
    expect(v.deckSize).toBe(16);
  });
});
