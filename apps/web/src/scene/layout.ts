/**
 * Board geometry in world units. The board is 10 x 10 and centred on the origin, START is the
 * bottom-right corner (+x, +z) and play runs clockwise seen from above: along the bottom
 * towards -x, up the left side towards -z, along the top towards +x, down the right side.
 * Pure maths, no three.js, so it can be unit tested.
 */
export const BOARD_HALF = 5;
export const CORNER = 1.3;
export const TILE = (BOARD_HALF * 2 - CORNER * 2) / 9;
/** Inner edge of the ring of spaces; inside it is the city. */
export const INNER = BOARD_HALF - CORNER;
/** Height of the printed board surface, so pieces stand on it rather than float. */
export const SURFACE_Y = -0.035;

export interface SpaceFrame {
  /** Centre of the tile. */
  x: number;
  z: number;
  /** Unit vector in the direction of travel along this side. */
  along: [number, number];
  /** Unit vector from the tile towards the centre of the board. */
  inward: [number, number];
  /** Tile size along the side; corners are square. */
  width: number;
  corner: boolean;
}

/** Rotates a side-0 point a quarter turn per side, matching the printed board. */
function rotate(side: number, x: number, z: number): [number, number] {
  switch (side % 4) {
    case 1:
      return [-z, x];
    case 2:
      return [-x, -z];
    case 3:
      return [z, -x];
    default:
      return [x, z];
  }
}

export function spaceFrame(index: number): SpaceFrame {
  const side = Math.floor(index / 10) % 4;
  const k = index % 10;
  const corner = k === 0;
  const depthMid = BOARD_HALF - CORNER / 2;
  const baseX = corner ? depthMid : INNER - (k - 0.5) * TILE;
  const [x, z] = rotate(side, baseX, depthMid);
  const [ax, az] = rotate(side, -1, 0);
  const [ix, iz] = rotate(side, 0, -1);
  return {
    x,
    z,
    along: [ax, az],
    inward: [ix, iz],
    width: corner ? CORNER : TILE,
    corner,
  };
}

/** The space under a point on the board, or null for the city or off the board. */
export function spaceAtPoint(x: number, z: number): number | null {
  if (Math.abs(x) > BOARD_HALF || Math.abs(z) > BOARD_HALF) return null;
  const step = (d: number) => Math.min(9, Math.max(1, Math.ceil(d / TILE)));
  if (z > INNER) {
    if (x > INNER) return 0;
    if (x < -INNER) return 10;
    return step(INNER - x);
  }
  if (z < -INNER) {
    if (x < -INNER) return 20;
    if (x > INNER) return 30;
    return 20 + step(x + INNER);
  }
  if (x < -INNER) return 10 + step(INNER - z);
  if (x > INNER) return 30 + step(z + INNER);
  return null;
}
