/**
 * Dice physics with cannon-es, kept free of rendering so it can be tested and reused.
 * A throw is simulated to rest in one go and recorded, so playback is frame-rate independent
 * and every client replays the same motion from the same throw.
 */
import * as CANNON from 'cannon-es';
import type { DiceThrow } from '@hometown/protocol';
import { BOARD_HALF, INNER, SURFACE_Y } from './layout.js';

export const DIE_SIZE = 0.55;
const HALF = DIE_SIZE / 2;
export const STEP = 1 / 120;
const MAX_STEPS = 6 * 120;
const GRAVITY = -30;
/** Invisible walls keep thrown dice near the board. */
export const WALL = 12;
/** Values per recorded step: position xyz and quaternion xyzw. */
export const FRAME = 7;

/** Offsets of each die from the throw origin, so they don't start inside each other. */
export function startOffset(i: number, n: number): [number, number, number] {
  return [(i - (n - 1) / 2) * (DIE_SIZE + 0.12), 0, (i % 2) * 0.2];
}

/**
 * Runs the whole throw and returns, per die, [x, y, z, qx, qy, qz, qw] for every step.
 * Same inputs give the same motion on every client.
 */
export function simulate(t: DiceThrow, n: number): Float32Array[] {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  world.allowSleep = true;
  const felt = new CANNON.Material('table');
  const bone = new CANNON.Material('die');
  world.addContactMaterial(
    new CANNON.ContactMaterial(felt, bone, { friction: 0.35, restitution: 0.3 }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(bone, bone, { friction: 0.2, restitution: 0.4 }),
  );
  const fixed = (shape: CANNON.Shape, x: number, y: number, z: number, q?: CANNON.Quaternion) => {
    const body = new CANNON.Body({ mass: 0, material: felt, shape });
    body.position.set(x, y, z);
    if (q) body.quaternion.copy(q);
    world.addBody(body);
  };
  // Ground, board slab, the city as a block, and walls around the play area.
  const flat = new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0);
  fixed(new CANNON.Plane(), 0, -0.5, 0, flat);
  const slab = 0.25;
  fixed(
    new CANNON.Box(new CANNON.Vec3(BOARD_HALF + 0.45, slab, BOARD_HALF + 0.45)),
    0,
    SURFACE_Y - slab,
    0,
  );
  fixed(new CANNON.Box(new CANNON.Vec3(INNER, 5, INNER)), 0, SURFACE_Y + 5, 0);
  for (const [x, z, ry] of [
    [WALL, 0, -Math.PI / 2],
    [-WALL, 0, Math.PI / 2],
    [0, WALL, Math.PI],
    [0, -WALL, 0],
  ] as const) {
    fixed(new CANNON.Plane(), x, 0, z, new CANNON.Quaternion().setFromEuler(0, ry, 0));
  }

  const bodies = Array.from({ length: n }, (_, i) => {
    const o = startOffset(i, n);
    const body = new CANNON.Body({
      mass: 1,
      material: bone,
      shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.25,
      linearDamping: 0.05,
      angularDamping: 0.08,
    });
    body.position.set(t.origin[0] + o[0], t.origin[1], t.origin[2] + o[2]);
    body.velocity.set(...t.velocity);
    const w = t.spin[i] ?? [0, 0, 0];
    body.angularVelocity.set(w[0], w[1], w[2]);
    world.addBody(body);
    return body;
  });

  const out = bodies.map(() => new Float32Array(MAX_STEPS * FRAME));
  let steps = 0;
  for (; steps < MAX_STEPS; steps++) {
    world.step(STEP);
    bodies.forEach((b, i) => {
      const f = out[i];
      if (!f) return;
      const k = steps * FRAME;
      f[k] = b.position.x;
      f[k + 1] = b.position.y;
      f[k + 2] = b.position.z;
      f[k + 3] = b.quaternion.x;
      f[k + 4] = b.quaternion.y;
      f[k + 5] = b.quaternion.z;
      f[k + 6] = b.quaternion.w;
    });
    if (steps > 30 && bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
      steps++;
      break;
    }
  }
  return out.map((f) => f.slice(0, Math.max(1, steps) * FRAME));
}
