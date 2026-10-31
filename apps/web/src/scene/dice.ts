/**
 * Physical dice. The player whose turn it is can pick the dice up, shake them and throw them;
 * everyone else watches the same throw.
 *
 * Fairness: the server decides the values. A throw is simulated to the end in one go
 * (cannon-es), then each die's pips are turned inside its cube (a cube symmetry, so the physics
 * is unchanged) so that the server's value lands on top. The recorded motion is then replayed.
 */
import * as THREE from 'three';
import type { DiceThrow } from '@hometown/protocol';
import { B, T, canvas2d, srgbTexture } from './builder.js';
import type { Builder } from './builder.js';
import { DIE_SIZE, FRAME, STEP, WALL, simulate, startOffset } from './dicePhysics.js';
import { INNER } from './layout.js';

const SIZE = DIE_SIZE;
const HALF = SIZE / 2;
const HOLD_HEIGHT = 1.6;
/** Keep held dice out over the ring of spaces, not inside the city. */
const KEEP_OUT = INNER + 0.6;

/** Outward normal of the face showing each value, matching the material order below. */
const FACE_NORMAL: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(1, 0, 0),
  6: new THREE.Vector3(-1, 0, 0),
  2: new THREE.Vector3(0, 1, 0),
  5: new THREE.Vector3(0, -1, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
};
const AXES = Object.values(FACE_NORMAL);

const PIPS: Record<number, [number, number][]> = {
  1: [[64, 64]],
  2: [
    [34, 34],
    [94, 94],
  ],
  3: [
    [34, 34],
    [64, 64],
    [94, 94],
  ],
  4: [
    [34, 34],
    [94, 34],
    [34, 94],
    [94, 94],
  ],
  5: [
    [34, 34],
    [94, 34],
    [64, 64],
    [34, 94],
    [94, 94],
  ],
  6: [
    [34, 30],
    [94, 30],
    [34, 64],
    [94, 64],
    [34, 98],
    [94, 98],
  ],
};

function faceMaterial(n: number): THREE.MeshStandardMaterial {
  const [c, x] = canvas2d(128, 128);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#e8344e';
  for (const [a, b] of PIPS[n] ?? []) {
    x.beginPath();
    x.arc(a, b, 12, 0, Math.PI * 2);
    x.fill();
  }
  return T(0xffffff, { map: srgbTexture(c), roughness: 0.4 });
}

interface Die {
  /** Follows the physics body. */
  body: THREE.Group;
  /** Turned inside the body so the right value ends on top. */
  cube: THREE.Mesh;
}

interface Playback {
  frames: Float32Array[];
  steps: number;
  t: number;
  onDone: () => void;
}

export class DiceTable {
  readonly group = new THREE.Group();
  private readonly dice: Die[] = [];
  private shown = 2;
  private playback: Playback | null = null;
  private held = false;
  private heldCount = 2;
  private readonly heldAt = new THREE.Vector3();
  private readonly samples: { t: number; p: THREE.Vector3 }[] = [];
  private readonly holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HOLD_HEIGHT);
  private releaseTimer = 0;
  private readonly tmp = new THREE.Vector3();
  /** True when the local player may pick the dice up. */
  canPickUp = false;

  constructor(b: Builder) {
    const mats = [1, 6, 2, 5, 3, 4].map(faceMaterial);
    const rest: [number, number, number][] = [
      [6.3, 2.4, 0.5],
      [6.9, 3.3, -0.3],
      [6.0, 3.9, 0.9],
    ];
    for (const [x, z, ry] of rest) {
      const body = b.group(x, -0.5 + HALF, z, this.group);
      body.rotation.y = ry;
      const cube = b.mesh(B(SIZE, SIZE, SIZE), mats, 0, 0, 0, { parent: body });
      this.dice.push({ body, cube });
    }
    this.setCount(2);
  }

  get busy(): boolean {
    return this.held || this.playback !== null;
  }

  get rolling(): boolean {
    return this.playback !== null;
  }

  private setCount(n: number): void {
    this.shown = n;
    this.dice.forEach((d, i) => (d.body.visible = i < n));
  }

  /** The die under a ray, if the dice can be picked up. */
  hit(ray: THREE.Raycaster): boolean {
    if (!this.canPickUp || this.busy) return false;
    const cubes = this.dice.slice(0, this.shown).map((d) => d.cube);
    return ray.intersectObjects(cubes, false).length > 0;
  }

  /** Pick the dice up (always two; Dubbeltärning rolls from its button). */
  grab(ray: THREE.Raycaster, now: number): void {
    this.held = true;
    this.heldCount = 2;
    this.setCount(2);
    this.samples.length = 0;
    this.move(ray, now);
  }

  move(ray: THREE.Raycaster, now: number): void {
    if (!this.held) return;
    const p = ray.ray.intersectPlane(this.holdPlane, new THREE.Vector3());
    if (!p) return;
    // Stay within the walls and out of the city.
    p.x = THREE.MathUtils.clamp(p.x, -WALL + 1, WALL - 1);
    p.z = THREE.MathUtils.clamp(p.z, -WALL + 1, WALL - 1);
    if (Math.abs(p.x) < KEEP_OUT && Math.abs(p.z) < KEEP_OUT) {
      if (Math.abs(p.x) > Math.abs(p.z)) p.x = Math.sign(p.x || 1) * KEEP_OUT;
      else p.z = Math.sign(p.z || 1) * KEEP_OUT;
    }
    this.heldAt.copy(p);
    this.samples.push({ t: now, p: p.clone() });
    while (this.samples.length > 2 && now - (this.samples[0]?.t ?? now) > 120) this.samples.shift();
  }

  /** Let go: returns the throw to send to the server. */
  release(now: number): DiceThrow {
    this.held = false;
    const first = this.samples[0];
    const v = new THREE.Vector3();
    if (first && now - first.t > 10) {
      v.copy(this.heldAt)
        .sub(first.p)
        .divideScalar((now - first.t) / 1000);
    }
    v.multiplyScalar(0.6);
    if (v.length() < 2) {
      // A tap rather than a flick: toss them gently towards the board's centre.
      v.set(-this.heldAt.x, 0, -this.heldAt.z).setLength(3);
    }
    v.clampLength(0, 13);
    v.y = 1.5;
    const spin = Array.from({ length: this.heldCount }, () => {
      const s = 10 + v.length() * 1.5;
      return [rnd(-s, s), rnd(-s, s), rnd(-s, s)] as [number, number, number];
    });
    this.releaseTimer = 3;
    return {
      origin: [this.heldAt.x, HOLD_HEIGHT, this.heldAt.z],
      velocity: [v.x, v.y, v.z],
      spin,
    };
  }

  /** Throw and land on `values`; calls onDone when the dice have settled. */
  play(t: DiceThrow, values: number[], instant: boolean, onDone: () => void): void {
    this.held = false;
    this.releaseTimer = 0;
    const n = Math.min(values.length, this.dice.length);
    this.setCount(n);
    const frames = simulate(t, n);
    const steps = frames[0] ? frames[0].length / FRAME : 0;
    // Turn each die's pips so its value ends up facing the sky.
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const die = this.dice[i];
      const f = frames[i];
      if (!die || !f) continue;
      const k = (steps - 1) * FRAME;
      q.set(f[k + 3] ?? 0, f[k + 4] ?? 0, f[k + 5] ?? 0, f[k + 6] ?? 1);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q.invert());
      const axis = AXES.reduce((best, a) => (a.dot(up) > best.dot(up) ? a : best));
      const want = FACE_NORMAL[values[i] ?? 2] ?? FACE_NORMAL[2]!;
      die.cube.quaternion.setFromUnitVectors(want, axis);
    }
    this.playback = { frames, steps, t: instant ? steps : 0, onDone };
    this.apply(this.playback);
    if (instant) this.finish();
  }

  private apply(pb: Playback): void {
    const s = Math.min(pb.steps - 1, Math.floor(pb.t));
    this.dice.forEach((d, i) => {
      const f = pb.frames[i];
      if (!f) return;
      const k = s * FRAME;
      d.body.position.set(f[k] ?? 0, f[k + 1] ?? 0, f[k + 2] ?? 0);
      d.body.quaternion.set(f[k + 3] ?? 0, f[k + 4] ?? 0, f[k + 5] ?? 0, f[k + 6] ?? 1);
    });
  }

  private finish(): void {
    const pb = this.playback;
    this.playback = null;
    pb?.onDone();
  }

  update(dt: number, time: number): void {
    if (this.held) {
      // Shake in the hand.
      this.dice.slice(0, this.heldCount).forEach((d, i) => {
        const [ox, , oz] = startOffset(i, this.heldCount);
        d.body.position.lerp(
          this.tmp.set(
            this.heldAt.x + ox + Math.sin(time * 31 + i) * 0.04,
            this.heldAt.y + Math.sin(time * 23 + i * 2) * 0.05,
            this.heldAt.z + oz + Math.cos(time * 29 + i) * 0.04,
          ),
          Math.min(1, dt * 18),
        );
        d.body.rotation.x += dt * (6 + i);
        d.body.rotation.z += dt * (5 - i);
      });
      return;
    }
    if (this.releaseTimer > 0) {
      // Thrown, waiting for the server; drop them if it never answers.
      this.releaseTimer -= dt;
      if (this.releaseTimer <= 0) this.dropHere();
    }
    const pb = this.playback;
    if (!pb) return;
    pb.t += dt / STEP;
    this.apply(pb);
    if (pb.t >= pb.steps - 1) this.finish();
  }

  /** The server refused the throw: just set the dice down where they are. */
  private dropHere(): void {
    for (const d of this.dice) d.body.position.y = -0.5 + HALF;
  }
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
