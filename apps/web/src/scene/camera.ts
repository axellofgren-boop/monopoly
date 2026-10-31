/**
 * Camera control in two modes:
 * - orbit: circle the board, zoom in and out (the default; good for playing);
 * - fly: move freely like a drone, down to street level and out over the forest,
 *   kept inside the world's limits.
 */
import * as THREE from 'three';
import { WORLD_CEILING, WORLD_RADIUS } from '@hometown/protocol';
import type { CameraPose } from '@hometown/protocol';
import { BOARD_HALF, INNER, SURFACE_Y } from './layout.js';

export type CameraMode = 'orbit' | 'fly';

const ORBIT_MIN = 2.2;
const ORBIT_MAX = 22;
/** Lens zoom: field of view as a share of the normal one (small = zoomed in). */
const LENS_MIN = 0.12;
const LENS_MAX = 1.5;
const FOV_MAX = 80;
/** Height kept above whatever is underneath while flying. */
const CLEARANCE = 0.12;
const FLY_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
]);

/** Height of the ground, board or city under a point. */
function floorAt(x: number, z: number): number {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax < INNER && az < INNER) return 0.21; // the city's islands
  if (ax < BOARD_HALF + 0.45 && az < BOARD_HALF + 0.45) return SURFACE_Y;
  return -0.5;
}

/** Signed smallest rotation from a to b, in radians. */
export function shortestAngle(a: number, b: number): number {
  const turn = Math.PI * 2;
  return ((((b - a) % turn) + turn * 1.5) % turn) - Math.PI;
}

export class CameraRig {
  mode: CameraMode = 'orbit';
  autoRotate = true;
  /** Normal field of view for the screen shape; the lens zoom scales it. */
  baseFov: number;
  private idle = 0;
  private lens = 1;
  private goalLens = 1;

  // orbit
  private yaw = 0.1;
  private elev = 0.74;
  private dist = 14.8;
  private readonly target = new THREE.Vector3(0, 1, 0);
  private readonly goal = this.target.clone();
  private goalDist: number | null = null;
  private goalYaw: number | null = null;
  private goalElev: number | null = null;

  // fly
  private readonly pos = new THREE.Vector3();
  private flyYaw = 0;
  private pitch = 0;
  private readonly vel = new THREE.Vector3();
  private readonly push = new THREE.Vector3();
  private readonly keys = new Set<string>();

  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.baseFov = camera.fov;
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    addEventListener('blur', () => this.keys.clear());
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.mode !== 'fly' || !FLY_KEYS.has(e.code)) return;
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
    this.idle = 0;
  };

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    const cam = this.camera;
    cam.getWorldDirection(this.dir);
    if (mode === 'fly') {
      this.pos.copy(cam.position);
      this.flyYaw = Math.atan2(-this.dir.x, -this.dir.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1));
      this.vel.set(0, 0, 0);
    } else {
      // Pick an orbit centre in front of the camera, then glide back to the whole board.
      const t = this.dir.y < -0.05 ? (0 - cam.position.y) / this.dir.y : 8;
      this.target.copy(cam.position).addScaledVector(this.dir, Math.min(t, 20));
      const off = this.tmp.copy(cam.position).sub(this.target);
      this.dist = THREE.MathUtils.clamp(off.length(), ORBIT_MIN, ORBIT_MAX);
      this.yaw = Math.atan2(off.x, off.z);
      this.elev = THREE.MathUtils.clamp(Math.asin(off.y / (off.length() || 1)), 0.25, 1.35);
      this.view('board');
      this.keys.clear();
    }
    this.mode = mode;
  }

  /** Orbit presets. */
  view(kind: 'board' | { x: number; z: number; facing: number }): void {
    if (this.mode === 'fly') this.setMode('orbit');
    this.goalLens = 1;
    if (kind === 'board') {
      this.goal.set(0, 1, 0);
      this.goalDist = 14.8;
      this.goalYaw = this.yaw + shortestAngle(this.yaw, 0.1);
      this.goalElev = 0.74;
    } else {
      this.goal.set(kind.x, 0.3, kind.z);
      this.goalDist = 4.2;
      this.goalYaw = this.yaw + shortestAngle(this.yaw, kind.facing);
      this.goalElev = 0.62;
    }
    this.idle = -6;
  }

  /** Stop any glide (the player grabbed the camera). */
  interrupt(): void {
    this.goalDist = this.goalYaw = this.goalElev = null;
    this.idle = 0;
  }

  /** One-finger drag or mouse drag, in pixels. */
  drag(dx: number, dy: number): void {
    this.idle = 0;
    // Turn slower when zoomed in, so the view doesn't whip around.
    dx *= this.lens;
    dy *= this.lens;
    if (this.mode === 'orbit') {
      this.yaw -= dx * 0.006;
      this.elev = THREE.MathUtils.clamp(this.elev + dy * 0.004, 0.25, 1.35);
    } else {
      this.flyYaw -= dx * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.45, 1.45);
    }
  }

  /**
   * Zoom the view like a camera lens: the camera (and your avatar) stays where it is and only
   * the field of view narrows or widens. factor < 1 means zoom in.
   */
  zoom(factor: number): void {
    this.idle = 0;
    this.goalLens = THREE.MathUtils.clamp(this.goalLens * factor, LENS_MIN, LENS_MAX);
  }

  /** Two-finger drag while flying: slide sideways and up/down. */
  pan(dx: number, dy: number): void {
    if (this.mode !== 'fly') return;
    const s = this.speed() * 0.01;
    this.push.x += -Math.cos(this.flyYaw) * dx * s;
    this.push.z += Math.sin(this.flyYaw) * dx * s;
    this.push.y += dy * s;
  }

  /** Flying is slow near the ground and fast high up. */
  private speed(): number {
    const above = this.pos.y - floorAt(this.pos.x, this.pos.z);
    return THREE.MathUtils.clamp(above * 0.9 + 0.8, 1, 9);
  }

  /** Returns true when the field of view changed this frame. */
  update(dt: number, allowAutoRotate: boolean): boolean {
    this.idle += dt;
    if (this.mode === 'fly') this.updateFly(dt);
    else this.updateOrbit(dt, allowAutoRotate);
    return this.updateLens(dt);
  }

  private updateLens(dt: number): boolean {
    // Ease in log space so zooming feels even at every level.
    const k = Math.min(1, dt * 10);
    this.lens = Math.exp(Math.log(this.lens) + (Math.log(this.goalLens) - Math.log(this.lens)) * k);
    if (Math.abs(this.lens - this.goalLens) < 1e-4) this.lens = this.goalLens;
    const fov = Math.min(FOV_MAX, this.baseFov * this.lens);
    if (Math.abs(fov - this.camera.fov) < 1e-3) return false;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    return true;
  }

  private updateOrbit(dt: number, allowAutoRotate: boolean): void {
    if (allowAutoRotate && this.autoRotate && this.idle > 3) {
      this.goalYaw = null;
      this.yaw += dt * 0.07;
    }
    const ease = Math.min(1, dt * 4);
    this.target.lerp(this.goal, ease);
    if (this.goalDist !== null) this.dist += (this.goalDist - this.dist) * ease;
    if (this.goalYaw !== null) this.yaw += (this.goalYaw - this.yaw) * ease;
    if (this.goalElev !== null) this.elev += (this.goalElev - this.elev) * ease;
    const { target, yaw, elev, dist } = this;
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(elev) * dist,
      target.y + Math.sin(elev) * dist,
      target.z + Math.cos(yaw) * Math.cos(elev) * dist,
    );
    this.camera.lookAt(target);
  }

  private updateFly(dt: number): void {
    const k = this.keys;
    const fwd =
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) -
      (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up =
      (k.has('Space') || k.has('KeyE') ? 1 : 0) -
      (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ') ? 1 : 0);
    const speed = this.speed();
    const sy = Math.sin(this.flyYaw);
    const cy = Math.cos(this.flyYaw);
    // Forward follows where you look (including up/down); strafe stays level.
    const cp = Math.cos(this.pitch);
    const want = this.tmp.set(
      (-sy * cp * fwd + cy * side) * speed,
      (Math.sin(this.pitch) * fwd + up) * speed,
      (-cy * cp * fwd - sy * side) * speed,
    );
    want.add(this.push);
    this.push.multiplyScalar(Math.max(0, 1 - dt * 6));
    this.vel.lerp(want, Math.min(1, dt * 8));
    this.pos.addScaledVector(this.vel, dt);

    // Stay inside the world: under the sky, above the ground, within the forest.
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD_RADIUS) {
      this.pos.x *= WORLD_RADIUS / r;
      this.pos.z *= WORLD_RADIUS / r;
    }
    const floor = floorAt(this.pos.x, this.pos.z) + CLEARANCE;
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, floor, WORLD_CEILING);

    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.flyYaw, 0, 'YXZ');
  }

  /** Where the camera is and where it looks, for other players' view of you. */
  pose(): CameraPose {
    this.camera.getWorldDirection(this.dir);
    const p = this.camera.position;
    return {
      p: [round(p.x), round(p.y), round(p.z)],
      yaw: round(Math.atan2(-this.dir.x, -this.dir.z)),
      pitch: round(Math.asin(THREE.MathUtils.clamp(this.dir.y, -1, 1))),
    };
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
