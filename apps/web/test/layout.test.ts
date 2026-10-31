import { describe, expect, it } from 'vitest';
import { BOARD_HALF, CORNER, spaceAtPoint, spaceFrame } from '../src/scene/layout.js';

describe('board layout', () => {
  it('puts the corners in START, Arresten, Fika, Ö-hopp order, clockwise from bottom-right', () => {
    const mid = BOARD_HALF - CORNER / 2;
    expect(spaceFrame(0)).toMatchObject({ x: mid, z: mid, corner: true });
    expect(spaceFrame(10)).toMatchObject({ x: -mid, z: mid, corner: true });
    expect(spaceFrame(20)).toMatchObject({ x: -mid, z: -mid, corner: true });
    expect(spaceFrame(30)).toMatchObject({ x: mid, z: -mid, corner: true });
  });

  it('points every tile inward towards the city', () => {
    for (let i = 0; i < 40; i++) {
      const f = spaceFrame(i);
      if (f.corner) continue;
      const dot = f.x * f.inward[0] + f.z * f.inward[1];
      expect(dot).toBeLessThan(0);
    }
  });

  it('maps every tile centre back to its own index', () => {
    for (let i = 0; i < 40; i++) {
      const f = spaceFrame(i);
      expect(spaceAtPoint(f.x, f.z)).toBe(i);
    }
  });

  it('returns null for the city and off the board', () => {
    expect(spaceAtPoint(0, 0)).toBeNull();
    expect(spaceAtPoint(6, 0)).toBeNull();
  });
});
