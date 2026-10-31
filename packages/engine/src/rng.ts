/**
 * Seeded pseudo-random numbers (mulberry32). The seed lives in game state so that every
 * game replays identically from its action log.
 */
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: next };
}

/** Holds a seed and hands out numbers; write the seed back to state when done. */
export class Rng {
  constructor(public seed: number) {}

  /** Float in [0, 1). */
  next(): number {
    const r = nextRandom(this.seed);
    this.seed = r.seed;
    return r.value;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  die(): number {
    return this.int(1, 6);
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error('Cannot pick from an empty list');
    return item;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}
