/**
 * The 3D game board: renderer, camera, the Stockholm city, and the pieces driven by game state
 * (tokens, houses, owner markers, dice, selection). The DOM UI sits on top of the canvas.
 */
import * as THREE from 'three';
import type { PublicState } from '@hometown/engine';
import type { CameraPose, DiceThrow, Token } from '@hometown/protocol';
import { TOKEN_INFO } from '../theme.js';
import { Avatars } from './avatars.js';
import { B, Builder, CYL, GLOW, T, canvas2d, srgbTexture } from './builder.js';
import { drawBoard } from './boardTexture.js';
import { CameraRig, shortestAngle } from './camera.js';
import type { CameraMode } from './camera.js';
import { buildCity } from './city.js';
import type { Animate } from './city.js';
import { DiceTable } from './dice.js';
import { CORNER, SURFACE_Y, spaceAtPoint, spaceFrame } from './layout.js';
import { bakeStatic, rescaleHalos } from './optimise.js';
import type { BakeResult } from './optimise.js';
import { FrameStats } from './stats.js';
import type { FrameStatsReport } from './stats.js';
import { buildToken } from './tokens.js';

export type { CameraMode } from './camera.js';
export type { FrameStatsReport } from './stats.js';

/** A roll to animate: how the dice were thrown and the values the server rolled. */
export interface RollAnimation {
  diceThrow: DiceThrow;
  dice: number[];
}

// Match the approved look's colour handling (authored against the older pipeline).
THREE.ColorManagement.enabled = false;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Hop {
  from: THREE.Vector3;
  to: THREE.Vector3;
  height: number;
  duration: number;
  yaw: number | null;
}

interface TokenPiece {
  object: THREE.Group;
  space: number;
  target: THREE.Vector3;
  hops: Hop[];
  hopT: number;
}

const yawAlong = ([ax, az]: [number, number]) => Math.atan2(-az, ax);
const yawFacing = ([ix, iz]: [number, number]) => Math.atan2(-ix, -iz);

export type CameraView = 'board' | 'me';

export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  private readonly rig: CameraRig;
  private readonly stats: FrameStats;
  private readonly builder: Builder;
  private readonly animateCity: Animate;
  private readonly baked: BakeResult;
  private readonly pieces = new THREE.Group();
  private readonly tokens = new Map<string, TokenPiece>();
  private readonly buildings = new Map<number, { key: string; group: THREE.Group }>();
  private readonly dice: DiceTable;
  private readonly avatars: Avatars;
  private readonly turnRing: THREE.Mesh;
  private readonly selectFrame: THREE.Group;
  private readonly hoverFrame: THREE.Group;
  private state: PublicState | null = null;
  /** Latest state whose token moves wait until the dice have landed. */
  private deferred: PublicState | null = null;
  private me: string | null = null;
  private time = 0;
  private last = performance.now();
  private frameId = 0;
  private poseTimer = 0;
  private lastPose = '';

  onSpaceClick: (index: number) => void = () => undefined;
  /** The local player threw the dice. */
  onThrow: (t: DiceThrow) => void = () => undefined;
  /** The local camera moved (throttled). */
  onCamera: (pose: CameraPose) => void = () => undefined;
  onStats: (r: FrameStatsReport) => void = () => undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.72;
    this.renderer = r;
    this.stats = new FrameStats(r, () => this.resize());
    this.stats.onReport = (report) => this.onStats(report);
    this.rig = new CameraRig(this.camera);

    const scene = this.scene;
    scene.fog = new THREE.Fog(0x1a2456, 18, 48);
    {
      const [c, x] = canvas2d(4, 256);
      const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#070d26');
      g.addColorStop(0.55, '#1b2560');
      g.addColorStop(1, '#4a3a7a');
      x.fillStyle = g;
      x.fillRect(0, 0, 4, 256);
      scene.background = srgbTexture(c);
    }
    scene.add(new THREE.HemisphereLight(0x5f70c0, 0x140f34, 0.32));
    const moon = new THREE.DirectionalLight(0xa8b8f0, 0.5);
    moon.position.set(-9, 15, 7);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.radius = 3;
    Object.assign(moon.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 45 });
    moon.shadow.bias = -0.0006;
    scene.add(moon);

    const world = new THREE.Group();
    scene.add(world, this.pieces);
    const b = new Builder(world);
    this.builder = b;
    this.buildBoard(b);
    const city = buildCity(b);
    this.animateCity = city.animate;
    // Merge everything that never moves into a few draw calls.
    this.baked = bakeStatic(world, new Set(city.moving), this.camera.fov);
    b.linkedHalos = this.baked.linked;
    this.dice = new DiceTable(b);
    this.avatars = new Avatars(b, this.pieces);
    scene.add(this.dice.group);

    this.turnRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.018, 12, 48),
      T(0xffd36b, GLOW(0xffb000, 1.2)),
    );
    this.turnRing.rotation.x = Math.PI / 2;
    this.turnRing.visible = false;
    this.pieces.add(this.turnRing);
    this.selectFrame = this.tileFrame(0xffd36b, 1.4);
    this.hoverFrame = this.tileFrame(0xffffff, 0.5);

    this.bindControls();
    addEventListener('resize', this.resize);
    this.resize();
    this.frameId = requestAnimationFrame(this.frame);
  }

  /** Creates the scene, or returns null when WebGL is not available. */
  static create(canvas: HTMLCanvasElement): BoardScene | null {
    try {
      return new BoardScene(canvas);
    } catch (err) {
      console.warn('3D board unavailable, falling back to 2D', err);
      return null;
    }
  }

  // ------------------------------------------------------------------ public API

  /** Slowly spins the camera while nobody is touching it (used behind the lobby). */
  setAutoRotate(on: boolean): void {
    this.rig.autoRotate = on;
  }

  update(state: PublicState | null, me: string | null, roll?: RollAnimation): void {
    this.state = state;
    this.me = me;
    if (!state) {
      for (const t of this.tokens.values()) this.pieces.remove(t.object);
      this.tokens.clear();
      this.avatars.setPlayers([], null);
      return;
    }
    const meP = state.players.find((p) => p.id === me);
    this.dice.canPickUp =
      !!meP && state.turn.current === me && state.phase.kind === 'awaitingRoll' && !meP.pendingItem;
    this.avatars.setPlayers(
      state.players.filter((p) => !p.bankrupt),
      me,
    );
    this.syncBuildings(state);
    if (roll) {
      // Tokens move once the dice have landed.
      this.deferred = state;
      this.dice.play(roll.diceThrow, roll.dice, reduceMotion, () => {
        const latest = this.deferred;
        this.deferred = null;
        if (latest) this.syncTokens(latest);
      });
    } else if (this.dice.rolling) {
      this.deferred = state;
    } else {
      this.syncTokens(state);
    }
  }

  setPoses(poses: Record<string, CameraPose>): void {
    this.avatars.setPoses(poses);
  }

  select(index: number | null): void {
    this.placeFrame(this.selectFrame, index);
  }

  get cameraMode(): CameraMode {
    return this.rig.mode;
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  view(kind: CameraView): void {
    const mine = this.me ? this.tokens.get(this.me) : undefined;
    if (kind === 'me' && mine) {
      const f = spaceFrame(mine.space);
      this.rig.view({ x: mine.target.x, z: mine.target.z, facing: yawFacing(f.inward) });
    } else {
      this.rig.view('board');
    }
  }

  zoom(factor: number): void {
    this.rig.zoom(factor);
  }

  // ------------------------------------------------------------------ board

  private buildBoard(b: Builder): void {
    b.mesh(CYL(45, 45, 0.2, 96), T(0x56659a), 0, -0.6, 0);
    b.mesh(B(10.9, 0.35, 10.9), T(0x2a3f8f), 0, -0.33, 0);
    b.mesh(B(10.5, 0.12, 10.5), T(0xffc94d, GLOW(0xffb000, 0.15)), 0, -0.1, 0);
    const [c] = canvas2d(4, 4);
    drawBoard(c);
    const tex = srgbTexture(c);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // Redraw once the web fonts have loaded so the street names use them.
    void document.fonts?.ready.then(() => {
      drawBoard(c);
      tex.needsUpdate = true;
    });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), T(0xdfe3ee, { map: tex }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = SURFACE_Y;
    top.receiveShadow = true;
    b.root.add(top);
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < 22; i++) {
        const p = -5.3 + i * (10.6 / 21);
        const spots: [number, number][] = [
          [p, 5.45],
          [-5.45, -p],
          [-p, -5.45],
          [5.45, p],
        ];
        const [x, z] = spots[s] ?? [0, 0];
        b.bulb(x, -0.1, z, i + s, 0.05);
      }
    }
  }

  private tileFrame(color: number, glow: number): THREE.Group {
    const g = new THREE.Group();
    // Its own material: the selection pulse changes it every frame.
    const mat = new THREE.MeshStandardMaterial({
      color,
      ...GLOW(color, glow),
      transparent: true,
      opacity: 0.95,
      roughness: 0.72,
    });
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.04), mat);
      g.add(bar);
    }
    g.visible = false;
    this.pieces.add(g);
    return g;
  }

  private placeFrame(frame: THREE.Group, index: number | null): void {
    if (index === null) {
      frame.visible = false;
      return;
    }
    const f = spaceFrame(index);
    const w = f.width;
    const d = CORNER;
    const [top, bottom, left, right] = frame.children as THREE.Mesh[];
    if (!top || !bottom || !left || !right) return;
    top.scale.set(w, 1, 1);
    top.position.set(0, 0, -d / 2);
    bottom.scale.set(w, 1, 1);
    bottom.position.set(0, 0, d / 2);
    left.scale.set(d, 1, 1);
    left.rotation.y = Math.PI / 2;
    left.position.set(-w / 2, 0, 0);
    right.scale.set(d, 1, 1);
    right.rotation.y = Math.PI / 2;
    right.position.set(w / 2, 0, 0);
    frame.position.set(f.x, SURFACE_Y + 0.02, f.z);
    frame.rotation.y = yawAlong(f.along);
    frame.visible = true;
  }

  // ------------------------------------------------------------------ tokens

  /** Where a player's token stands on a tile, given who else is there. */
  private slot(index: number, k: number, n: number): THREE.Vector3 {
    const f = spaceFrame(index);
    // Two columns across the tile, up to three rows deep (towards the outer edge).
    const cols = n === 1 ? 1 : 2;
    const rows = Math.ceil(n / cols);
    const col = k % cols;
    const row = Math.floor(k / cols);
    const along = (col - (cols - 1) / 2) * Math.min(0.42, f.width / 2);
    const out = f.corner ? 0 : 0.14;
    const inward = (row - (rows - 1) / 2) * 0.3 - out;
    return new THREE.Vector3(
      f.x + f.along[0] * along + f.inward[0] * inward,
      SURFACE_Y,
      f.z + f.along[1] * along + f.inward[1] * inward,
    );
  }

  private syncTokens(state: PublicState): void {
    const active = state.players.filter((p) => !p.bankrupt);
    for (const [id, piece] of this.tokens) {
      if (!active.some((p) => p.id === id)) {
        this.pieces.remove(piece.object);
        this.tokens.delete(id);
      }
    }
    for (const p of active) {
      const same = active.filter((o) => o.position === p.position);
      const target = this.slot(p.position, same.indexOf(p), same.length);
      // Shrink tokens a little when several share a tile so they don't overlap.
      const scale = same.length > 1 ? 0.8 : 1;
      let piece = this.tokens.get(p.id);
      if (!piece) {
        const object = buildToken(this.builder, p.token as Token);
        object.position.copy(target);
        object.rotation.y = yawAlong(spaceFrame(p.position).along);
        this.pieces.add(object);
        object.scale.setScalar(scale);
        piece = { object, space: p.position, target, hops: [], hopT: 0 };
        this.tokens.set(p.id, piece);
        continue;
      }
      piece.object.scale.setScalar(scale);
      if (piece.space !== p.position) {
        this.queueMove(piece, p.position, target, p.inJail);
      } else if (!piece.target.equals(target)) {
        piece.hops.push({
          from: piece.target.clone(),
          to: target,
          height: 0,
          duration: 0.25,
          yaw: null,
        });
      }
      piece.space = p.position;
      piece.target = target;
    }
  }

  private queueMove(piece: TokenPiece, to: number, target: THREE.Vector3, jailed: boolean): void {
    const from = piece.space;
    const steps = (to - from + 40) % 40;
    let at = piece.target.clone();
    if (jailed || steps === 0 || steps > 12) {
      piece.hops.push({ from: at, to: target, height: 1.4, duration: 0.9, yaw: null });
      return;
    }
    for (let s = 1; s <= steps; s++) {
      const index = (from + s) % 40;
      const next = s === steps ? target : this.slot(index, 0, 1);
      piece.hops.push({
        from: at,
        to: next,
        height: 0.32,
        duration: 0.2,
        yaw: yawAlong(spaceFrame(index).along),
      });
      at = next;
    }
  }

  private animateTokens(dt: number): void {
    for (const piece of this.tokens.values()) {
      const hop = piece.hops[0];
      if (!hop) continue;
      if (reduceMotion) {
        const lastHop = piece.hops[piece.hops.length - 1] ?? hop;
        piece.object.position.copy(lastHop.to);
        piece.hops.length = 0;
        continue;
      }
      piece.hopT += dt / hop.duration;
      const t = Math.min(1, piece.hopT);
      piece.object.position.lerpVectors(hop.from, hop.to, t);
      piece.object.position.y += Math.sin(Math.PI * t) * hop.height;
      if (hop.yaw !== null) {
        piece.object.rotation.y +=
          shortestAngle(piece.object.rotation.y, hop.yaw) * Math.min(1, dt * 12);
      }
      if (t >= 1) {
        piece.hops.shift();
        piece.hopT = 0;
      }
    }
    const current = this.state?.turn.current;
    const piece = current ? this.tokens.get(current) : undefined;
    this.turnRing.visible = Boolean(piece) && this.state?.phase.kind !== 'gameOver';
    if (piece) {
      this.turnRing.position.set(
        piece.object.position.x,
        piece.object.position.y + 0.02,
        piece.object.position.z,
      );
      const k = reduceMotion ? 1 : 1 + 0.08 * Math.sin(this.time * 4);
      this.turnRing.scale.setScalar(k);
    }
  }

  // ------------------------------------------------------------------ buildings

  private syncBuildings(state: PublicState): void {
    const color = new Map(
      state.players.map((p) => [p.id, TOKEN_INFO[p.token as Token]?.color ?? '#ffffff']),
    );
    for (const [key, prop] of Object.entries(state.properties)) {
      const index = Number(key);
      const sig = prop.owner
        ? `${prop.owner}|${prop.houses}|${prop.landmark}|${prop.mortgaged}`
        : '';
      const existing = this.buildings.get(index);
      if (existing?.key === sig) continue;
      if (existing) this.pieces.remove(existing.group);
      this.buildings.delete(index);
      if (!prop.owner) continue;
      const group = this.buildPropertyPieces(index, prop, color.get(prop.owner) ?? '#ffffff');
      this.pieces.add(group);
      this.buildings.set(index, { key: sig, group });
    }
  }

  private buildPropertyPieces(
    index: number,
    prop: PublicState['properties'][number],
    ownerColor: string,
  ): THREE.Group {
    const b = this.builder;
    const f = spaceFrame(index);
    const g = new THREE.Group();
    g.position.set(f.x, 0, f.z);
    g.rotation.y = yawFacing(f.inward);
    // In this local frame +z points outward and +x runs against the direction of travel.
    const edge = CORNER / 2;
    b.mesh(
      B(f.width * 0.86, 0.025, 0.07),
      T(ownerColor, GLOW(ownerColor, 0.35)),
      0,
      SURFACE_Y + 0.012,
      edge - 0.07,
      {
        parent: g,
      },
    );
    const band = -edge + CORNER * 0.12;
    if (prop.landmark) {
      b.gableHouse(0, band, 0.34, 0.2, 0.2, 0xff4747, 0x7a1a1a, {
        chimney: false,
        y: SURFACE_Y,
        parent: g,
      });
    } else {
      const xs = [[], [0], [-0.12, 0.12], [-0.22, 0, 0.22]][prop.houses] ?? [];
      for (const x of xs) {
        b.gableHouse(x, band, 0.16, 0.16, 0.12, 0x36d68b, 0x1f6f45, {
          chimney: false,
          y: SURFACE_Y,
          parent: g,
        });
      }
    }
    if (prop.mortgaged) {
      const shade = new THREE.Mesh(
        new THREE.PlaneGeometry(f.width - 0.04, CORNER - 0.04),
        new THREE.MeshBasicMaterial({
          color: 0x0b1430,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      );
      shade.rotation.x = -Math.PI / 2;
      shade.position.y = SURFACE_Y + 0.004;
      g.add(shade);
    }
    return g;
  }

  // ------------------------------------------------------------------ camera and input

  private bindControls(): void {
    const canvas = this.canvas;
    const ptrs = new Map<number, { x: number; y: number }>();
    let pinch0 = 0;
    let down: { x: number; y: number } | null = null;
    let grabbing: number | null = null;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);
    const hitPoint = new THREE.Vector3();
    const aim = (e: PointerEvent): THREE.Raycaster => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.camera);
      return raycaster;
    };
    const pick = (e: PointerEvent): number | null => {
      const hit = aim(e).ray.intersectPlane(plane, hitPoint);
      return hit ? spaceAtPoint(hit.x, hit.z) : null;
    };
    const mid = () => {
      const [a, b] = [...ptrs.values()];
      return a && b
        ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }
        : null;
    };
    let mid0: { x: number; y: number } | null = null;

    canvas.addEventListener('pointerdown', (e) => {
      this.rig.interrupt();
      canvas.setPointerCapture(e.pointerId);
      if (ptrs.size === 0 && this.dice.hit(aim(e))) {
        grabbing = e.pointerId;
        this.dice.grab(raycaster, performance.now());
        canvas.style.cursor = 'grabbing';
        return;
      }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down = ptrs.size === 1 ? { x: e.clientX, y: e.clientY } : null;
      const m = mid();
      if (m) {
        pinch0 = m.d;
        mid0 = m;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (grabbing === e.pointerId) {
        this.dice.move(aim(e), performance.now());
        return;
      }
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.state) {
          const overDice = this.dice.hit(aim(e));
          const index = overDice ? null : pick(e);
          this.placeFrame(this.hoverFrame, index);
          canvas.style.cursor = overDice ? 'grab' : index === null ? '' : 'pointer';
        }
        return;
      }
      if (ptrs.size === 1) this.rig.drag(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
      const m = mid();
      if (m) {
        if (pinch0) this.rig.zoom(pinch0 / m.d);
        if (mid0) this.rig.pan(m.x - mid0.x, mid0.y - m.y);
        pinch0 = m.d;
        mid0 = m;
      }
    });
    const up = (e: PointerEvent) => {
      if (grabbing === e.pointerId) {
        grabbing = null;
        canvas.style.cursor = '';
        this.onThrow(this.dice.release(performance.now()));
        return;
      }
      ptrs.delete(e.pointerId);
      pinch0 = 0;
      mid0 = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && this.state) {
        const index = pick(e);
        if (index !== null) this.onSpaceClick(index);
      }
      down = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => {
      if (grabbing === e.pointerId) up(e);
      ptrs.clear();
      down = null;
    });
    canvas.addEventListener('pointerleave', () => this.placeFrame(this.hoverFrame, null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.rig.zoom(1 + Math.sign(e.deltaY) * 0.08);
      },
      { passive: false },
    );
  }

  private readonly resize = (): void => {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 55 : 40;
    this.camera.updateProjectionMatrix();
    if (this.baked) rescaleHalos(this.baked.halos, this.camera.fov);
  };

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (!reduceMotion) {
      this.animateCity(dt, this.time);
      this.builder.animateBulbs(this.time);
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 5);
      for (const bar of this.selectFrame.children as THREE.Mesh[]) {
        (bar.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 * pulse;
      }
    }
    this.animateTokens(dt);
    this.dice.update(dt, this.time);
    this.avatars.update(dt, this.time);
    this.rig.update(dt, !reduceMotion);
    this.sendPose(dt);
    this.renderer.render(this.scene, this.camera);
    this.stats.frame(now);
    this.frameId = requestAnimationFrame(this.frame);
  };

  /** Tells the others where we look, at most five times a second and only when it changed. */
  private sendPose(dt: number): void {
    this.poseTimer -= dt;
    if (!this.state || this.poseTimer > 0) return;
    this.poseTimer = 0.2;
    const pose = this.rig.pose();
    const key = JSON.stringify(pose);
    if (key === this.lastPose) return;
    this.lastPose = key;
    this.onCamera(pose);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.rig.dispose();
    removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
