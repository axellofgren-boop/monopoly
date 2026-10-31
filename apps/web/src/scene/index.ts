/**
 * The 3D game board: renderer, camera, the Stockholm city, and the pieces driven by game state
 * (tokens, houses, owner markers, dice, selection). The DOM UI sits on top of the canvas.
 */
import * as THREE from 'three';
import type { PublicState } from '@hometown/engine';
import type { Token } from '@hometown/protocol';
import { TOKEN_INFO } from '../theme.js';
import { B, Builder, CYL, GLOW, T, canvas2d, srgbTexture } from './builder.js';
import { drawBoard } from './boardTexture.js';
import { buildCity } from './city.js';
import type { Animate } from './city.js';
import { CORNER, SURFACE_Y, spaceAtPoint, spaceFrame } from './layout.js';
import { buildToken } from './tokens.js';

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

interface DieAnim {
  group: THREE.Group;
  cube: THREE.Mesh;
  rest: THREE.Euler;
  spin: THREE.Vector3;
  t: number;
}

/** Euler angles that turn each face value to the top. Face order matches dieMaterials. */
const DIE_FACE_UP: Record<number, [number, number, number]> = {
  1: [0, 0, Math.PI / 2],
  2: [0, 0, 0],
  3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0],
  5: [Math.PI, 0, 0],
  6: [0, 0, -Math.PI / 2],
};

const yawAlong = ([ax, az]: [number, number]) => Math.atan2(-az, ax);
const yawFacing = ([ix, iz]: [number, number]) => Math.atan2(-ix, -iz);

export type CameraView = 'board' | 'me';

export class BoardScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  private readonly builder: Builder;
  private readonly animateCity: Animate;
  private readonly pieces = new THREE.Group();
  private readonly tokens = new Map<string, TokenPiece>();
  private readonly buildings = new Map<number, { key: string; group: THREE.Group }>();
  private readonly dice: DieAnim[] = [];
  private readonly turnRing: THREE.Mesh;
  private readonly selectFrame: THREE.Group;
  private readonly hoverFrame: THREE.Group;
  private state: PublicState | null = null;
  private me: string | null = null;
  private diceKey = '';
  private autoRotate = true;

  // camera
  private yaw = 0.1;
  private elev = 0.74;
  private dist = 14.8;
  private readonly target = new THREE.Vector3(0, 1, 0);
  private readonly goal = this.target.clone();
  private goalDist: number | null = null;
  private goalYaw: number | null = null;
  private goalElev: number | null = null;
  private idle = 0;
  private time = 0;
  private last = performance.now();
  private frameId = 0;

  onSpaceClick: (index: number) => void = () => undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.72;
    this.renderer = r;

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
    moon.shadow.mapSize.set(4096, 4096);
    moon.shadow.radius = 3;
    Object.assign(moon.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 45 });
    moon.shadow.bias = -0.0006;
    scene.add(moon);

    const world = new THREE.Group();
    scene.add(world, this.pieces);
    const b = new Builder(world);
    this.builder = b;
    this.buildBoard(b);
    this.animateCity = buildCity(b);
    this.buildDice(b);

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
    this.autoRotate = on;
  }

  update(state: PublicState | null, me: string | null): void {
    this.state = state;
    this.me = me;
    if (!state) {
      for (const t of this.tokens.values()) this.pieces.remove(t.object);
      this.tokens.clear();
      return;
    }
    this.syncTokens(state);
    this.syncBuildings(state);
    this.syncDice(state);
  }

  select(index: number | null): void {
    this.placeFrame(this.selectFrame, index);
  }

  view(kind: CameraView): void {
    const mine = this.me ? this.tokens.get(this.me) : undefined;
    if (kind === 'me' && mine) {
      const f = spaceFrame(mine.space);
      this.goal.set(mine.target.x, 0.3, mine.target.z);
      this.goalDist = 4.2;
      this.goalYaw = this.nearestYaw(yawFacing(f.inward));
      this.goalElev = 0.62;
    } else {
      this.goal.set(0, 1, 0);
      this.goalDist = 14.8;
      this.goalYaw = this.nearestYaw(0.1);
      this.goalElev = 0.74;
    }
    this.idle = -6;
  }

  zoom(factor: number): void {
    this.goalDist = null;
    this.dist = clampDist(this.dist * factor);
    this.idle = 0;
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
    const mat = T(color, { ...GLOW(color, glow), transparent: true, opacity: 0.95 });
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

  // ------------------------------------------------------------------ dice

  private buildDice(b: Builder): void {
    const face = (n: number) => {
      const [c, x] = canvas2d(128, 128);
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#e8344e';
      const pips: Record<number, [number, number][]> = {
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
      for (const [a, bb] of pips[n] ?? []) {
        x.beginPath();
        x.arc(a, bb, 12, 0, Math.PI * 2);
        x.fill();
      }
      return T(0xffffff, { map: srgbTexture(c) });
    };
    const mats = [1, 6, 2, 5, 3, 4].map(face);
    const spots: [number, number, number][] = [
      [6.3, 2.4, 0.5],
      [6.9, 3.3, -0.3],
      [6.0, 3.9, 0.9],
    ];
    for (const [x, z, ry] of spots) {
      const group = b.group(x, -0.225, z);
      group.rotation.y = ry;
      const cube = b.mesh(B(0.55, 0.55, 0.55), mats, 0, 0, 0, { parent: group });
      group.visible = this.dice.length < 2;
      this.dice.push({ group, cube, rest: new THREE.Euler(), spin: new THREE.Vector3(), t: 1 });
    }
  }

  private syncDice(state: PublicState): void {
    const dice = state.turn.lastDice;
    const key = `${state.round}|${state.turn.current}|${dice?.join(',') ?? ''}`;
    if (!dice || key === this.diceKey) return;
    const first = this.diceKey === '';
    this.diceKey = key;
    this.dice.forEach((d, i) => {
      const value = dice[i];
      d.group.visible = value !== undefined;
      if (value === undefined) return;
      const [rx, ry, rz] = DIE_FACE_UP[value] ?? [0, 0, 0];
      d.rest.set(rx, ry, rz);
      d.spin.set(8 + Math.random() * 6, 6 + Math.random() * 6, 7 + Math.random() * 6);
      d.t = first || reduceMotion ? 1 : 0;
      if (d.t === 1) d.cube.rotation.copy(d.rest);
    });
  }

  private animateDice(dt: number): void {
    for (const d of this.dice) {
      if (d.t >= 1) continue;
      d.t = Math.min(1, d.t + dt / 0.8);
      const left = 1 - d.t;
      const ease = left * left;
      d.cube.rotation.set(
        d.rest.x + d.spin.x * ease,
        d.rest.y + d.spin.y * ease,
        d.rest.z + d.spin.z * ease,
      );
      d.cube.position.y = Math.abs(Math.sin(d.t * Math.PI * 2)) * 0.5 * left;
    }
  }

  // ------------------------------------------------------------------ camera and input

  private nearestYaw(yaw: number): number {
    return this.yaw + shortestAngle(this.yaw, yaw);
  }

  private bindControls(): void {
    const canvas = this.canvas;
    const ptrs = new Map<number, { x: number; y: number }>();
    let pinch0 = 0;
    let down: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);
    const pick = (e: PointerEvent): number | null => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.camera);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      return hit ? spaceAtPoint(hit.x, hit.z) : null;
    };
    const interrupt = () => {
      this.goalDist = this.goalYaw = this.goalElev = null;
      this.idle = 0;
    };
    canvas.addEventListener('pointerdown', (e) => {
      interrupt();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      down = ptrs.size === 1 ? { x: e.clientX, y: e.clientY } : null;
      canvas.setPointerCapture(e.pointerId);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        if (a && b) pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.state) {
          const index = pick(e);
          this.placeFrame(this.hoverFrame, index);
          canvas.style.cursor = index === null ? '' : 'pointer';
        }
        return;
      }
      this.idle = 0;
      if (ptrs.size === 1) {
        this.yaw -= (e.clientX - p.x) * 0.006;
        this.elev = Math.min(1.35, Math.max(0.25, this.elev + (e.clientY - p.y) * 0.004));
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0) this.dist = clampDist((this.dist * pinch0) / d);
        pinch0 = d;
      }
    });
    const up = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      pinch0 = 0;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && this.state) {
        const index = pick(e);
        if (index !== null) this.onSpaceClick(index);
      }
      down = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => {
      ptrs.clear();
      down = null;
    });
    canvas.addEventListener('pointerleave', () => this.placeFrame(this.hoverFrame, null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(1 + Math.sign(e.deltaY) * 0.08);
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
  };

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.idle += dt;
    if (!reduceMotion) {
      if (this.autoRotate && this.idle > 3) {
        this.goalYaw = null;
        this.yaw += dt * 0.07;
      }
      this.animateCity(dt, this.time);
      this.builder.animateBulbs(this.time);
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 5);
      for (const bar of this.selectFrame.children as THREE.Mesh[]) {
        (bar.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 * pulse;
      }
    }
    this.animateTokens(dt);
    this.animateDice(dt);
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
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}

function clampDist(d: number): number {
  return Math.min(22, Math.max(2.2, d));
}

/** Signed smallest rotation from a to b, in radians. */
function shortestAngle(a: number, b: number): number {
  const turn = Math.PI * 2;
  return ((((b - a) % turn) + turn * 1.5) % turn) - Math.PI;
}
