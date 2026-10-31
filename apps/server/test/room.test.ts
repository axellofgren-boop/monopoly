import { describe, expect, it } from 'vitest';
import type { GameState } from '@hometown/engine';
import type { ServerMessage } from '@hometown/protocol';
import {
  AWAY_AFTER_MS,
  MINIGAME_GRACE_MS,
  MINIGAME_PLAY_MS,
  Room,
  RoomError,
  cleanName,
} from '../src/room.js';

const T0 = 1_000_000;

function setup() {
  const inbox: Record<string, ServerMessage[]> = { a: [], b: [] };
  const room = new Room('ABCDE', 7, T0);
  const a = room.join('Ann', 'dalahast', (m) => inbox.a!.push(m), T0);
  const b = room.join('Bo', 'alg', (m) => inbox.b!.push(m), T0);
  const last = (who: 'a' | 'b') => inbox[who]!.at(-1)!;
  const state = (who: 'a' | 'b' = 'a') => {
    const msgs = inbox[who]!.filter((m) => m.type === 'state');
    const m = msgs.at(-1);
    if (m?.type !== 'state') throw new Error('no state yet');
    return m.state;
  };
  return { room, a, b, inbox, last, state };
}

describe('Room', () => {
  it('welcomes players and shares the lobby', () => {
    const { a, last } = setup();
    expect(a.host).toBe(true);
    const lobby = last('a');
    expect(lobby.type).toBe('lobby');
    if (lobby.type === 'lobby') expect(lobby.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);
  });

  it('only lets the host start, and only with two or more players', () => {
    const { room, a, b } = setup();
    expect(() => room.start(b.id, T0)).toThrow(RoomError);
    room.start(a.id, T0);
    expect(room.started).toBe(true);
    expect(() => room.join('Cy', 'viking', () => {}, T0)).toThrow(/already started/);
  });

  it('swaps a taken token for a free one and cleans names', () => {
    const { room } = setup();
    expect(room.join('X', 'alg', () => {}, T0).token).toBe('kanelbulle');
    expect(cleanName('  Sven   Svensson the third of Södermalm ')).toBe('Sven Svensson th');
    expect(() => cleanName('   ')).toThrow();
  });

  it('runs intents for the right player and ignores forced dice', () => {
    const { room, a, b, state, last } = setup();
    room.start(a.id, T0);
    const current = state().turn.current;
    const other = current === a.id ? b : a;
    room.intent(other.id, { type: 'ROLL' }, T0);
    const err = last(other.id === a.id ? 'a' : 'b');
    expect(err).toEqual({ type: 'error', message: 'It is not your turn' });

    room.intent(current, { type: 'ROLL', dice: [6, 6] } as never, T0);
    expect(state().turn.lastDice).not.toBeNull();
    // With forced dice ignored, the RNG decided; a 6+6 from the client must not be trusted.
    expect(state().phase.kind).not.toBe('awaitingRoll' as never);
  });

  it('hands a long-disconnected player to the autopilot', () => {
    const { room, a, b, state } = setup();
    room.start(a.id, T0);
    const current = state().turn.current;
    room.disconnect(current, T0);
    room.tick(T0 + 1000);
    expect(state(current === a.id ? 'b' : 'a').turn.lastDice).toBeNull();
    room.tick(T0 + AWAY_AFTER_MS);
    expect(state(current === a.id ? 'b' : 'a').turn.lastDice).not.toBeNull();
    void b;
  });

  it('collects minigame scores and pays out once everyone has played', () => {
    const { room, a, b, state } = setup();
    room.start(a.id, T0);
    room.minigameScore(a.id, 5); // ignored outside a minigame
    // Put the room into a minigame, as landing on a Minispel space would.
    const inner = room as unknown as { game: GameState; minigameStartedAt: number };
    inner.game = {
      ...inner.game,
      phase: { kind: 'minigame', reason: 'space', players: [a.id, b.id], endsAt: T0 + 40_000 },
      resume: { kind: 'continueTurn' },
    };
    inner.minigameStartedAt = T0;
    room.minigameScore(a.id, 12);
    room.tick(T0 + 1000);
    expect(inner.game.phase.kind).toBe('minigame'); // still waiting for Bo
    room.minigameScore(b.id, 4);
    room.tick(T0 + 2000);
    const cash = Object.fromEntries(state().players.map((p) => [p.id, p.cash]));
    expect(cash[a.id]).toBe(2650);
    expect(cash[b.id]).toBe(2575);
  });

  it('closes a minigame without prizes if nobody sends scores in time', () => {
    const { room, a, b } = setup();
    room.start(a.id, T0);
    const inner = room as unknown as { game: GameState; minigameStartedAt: number };
    inner.game = {
      ...inner.game,
      phase: { kind: 'minigame', reason: 'space', players: [a.id, b.id], endsAt: T0 + 40_000 },
      resume: { kind: 'continueTurn' },
    };
    inner.minigameStartedAt = T0;
    room.tick(T0 + MINIGAME_PLAY_MS + MINIGAME_GRACE_MS);
    expect(inner.game.phase.kind).toBe('turnEnd');
  });
});
