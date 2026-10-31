import { describe, expect, it } from 'vitest';
import { randomThrow } from '@hometown/protocol';
import { DIE_SIZE, FRAME, simulate } from '../src/scene/dicePhysics.js';

/** Deterministic stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe('dice physics', () => {
  it('replays the same throw identically', () => {
    const t = randomThrow(2, seeded(3));
    expect(simulate(t, 2)).toEqual(simulate(t, 2));
  });

  it('brings every die to rest flat on something', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const t = randomThrow(3, seeded(seed));
      for (const f of simulate(t, 3)) {
        const k = f.length - FRAME;
        const [x, y, z] = [f[k]!, f[k + 1]!, f[k + 2]!];
        expect(Number.isFinite(x + y + z)).toBe(true);
        // Resting on the ground (-0.5), the board (~0) or another die, never floating high.
        expect(y).toBeGreaterThan(-0.5 + DIE_SIZE / 2 - 0.05);
        expect(y).toBeLessThan(1.2);
      }
    }
  });
});
