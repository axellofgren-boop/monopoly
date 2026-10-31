/**
 * Shared materials and mesh helpers for the 3D scene, ported from the approved look (round 3).
 * A Builder owns a seeded RNG so the city looks the same on every load.
 */
import * as THREE from 'three';

export type Rng = (a?: number, b?: number) => number;

export function seededRng(seed: number): Rng {
  let s = seed;
  return (a = 0, b = 1) => {
    s = (s * 16807) % 2147483647;
    return a + (s / 2147483647) * (b - a);
  };
}

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('2D canvas is not available');
  return [c, x];
}

export function srgbTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** Cache key for material options made only of plain values and colours; null otherwise. */
function materialKey(color: THREE.ColorRepresentation, o: object): string | null {
  const parts: string[] = [new THREE.Color(color).getHexString()];
  for (const [k, v] of Object.entries(o)) {
    if (v instanceof THREE.Color) parts.push(`${k}=${v.getHexString()}`);
    else if (typeof v === 'object' && v !== null) return null;
    else parts.push(`${k}=${String(v)}`);
  }
  return parts.join('|');
}

/**
 * Standard PBR material with the look's default roughness. Materials without textures are
 * shared, so identical colours cost one material and can be merged into one draw call.
 * Treat the result as read-only; create a material directly if it needs to change.
 */
export const T = (
  color: THREE.ColorRepresentation,
  o: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial => {
  const key = materialKey(color, o);
  const hit = key ? materialCache.get(key) : undefined;
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...o });
  if (key) materialCache.set(key, m);
  return m;
};

export const GLOW = (color: THREE.ColorRepresentation, i = 1) => ({
  emissive: new THREE.Color(color),
  emissiveIntensity: i,
});

export const BASIC = (c: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color: c });

export const SNOW = T(0xd3dcee);

export const BULB_COLORS = [0xff5f8f, 0xffd34d, 0x5fe0ff, 0x7dff9a] as const;

export const haloTexture = (() => {
  const [c, x] = canvas2d(64, 64);
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

export interface MeshOptions {
  parent?: THREE.Object3D;
  rx?: number;
  ry?: number;
  rz?: number;
  shadow?: boolean;
}

const boxCache = new Map<string, THREE.BoxGeometry>();
/** Cached box geometry; boxes of the same size share one buffer. */
export const B = (w: number, h: number, d: number): THREE.BoxGeometry => {
  const k = `${w},${h},${d}`;
  let g = boxCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(k, g);
  }
  return g;
};

export const CYL = (rt: number, rb: number, h: number, s = 40) =>
  new THREE.CylinderGeometry(rt, rb, h, s);

export function ellipsoid(r: number, sx: number, sy: number, sz: number): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(r, 40, 28);
  g.scale(sx, sy, sz);
  return g;
}

export function capsule(r: number, h: number, seg = 12): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 16;
    pts.push(new THREE.Vector2(Math.max(1e-4, r * Math.cos(a)), -h / 2 + r * Math.sin(a)));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i * Math.PI) / 16;
    pts.push(new THREE.Vector2(Math.max(1e-4, r * Math.cos(a)), h / 2 + r * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, seg);
}

export function prism(w: number, h: number, d: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export interface GableOptions {
  y?: number;
  ry?: number;
  steps?: boolean;
  chimney?: boolean;
  parent?: THREE.Object3D;
}

export class Builder {
  readonly rnd: Rng;
  readonly bulbMats = BULB_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  readonly haloMats = BULB_COLORS.map(
    (c) =>
      new THREE.SpriteMaterial({
        map: haloTexture,
        color: c,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
  );
  private readonly bulbGeo = new THREE.SphereGeometry(1, 14, 10);
  private readonly layouts: (string | null)[][];
  private readonly facadeCache = new Map<string, { map: THREE.Texture; em: THREE.Texture }>();
  private readonly facadeMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** Halo point clouds that follow the bulb blinking (set after baking). */
  linkedHalos = new Map<THREE.SpriteMaterial, THREE.PointsMaterial[]>();

  constructor(
    readonly root: THREE.Object3D,
    seed = 7,
  ) {
    this.rnd = seededRng(seed);
    const rnd = this.rnd;
    this.layouts = [0, 1, 2].map(() =>
      Array.from({ length: 16 }, () =>
        rnd() < 0.66 ? (rnd() < 0.8 ? '#ffcf7a' : rnd() < 0.5 ? '#a8dcff' : '#ffb0d4') : null,
      ),
    );
  }

  mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
    o: MeshOptions = {},
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.shadow !== false;
    m.receiveShadow = true;
    (o.parent ?? this.root).add(m);
    return m;
  }

  group(x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  /** Window-bay facade: colour and lit-window maps share a layout so they line up. */
  private facadeTextures(color: THREE.ColorRepresentation, li: number) {
    const key = `${String(color)}/${li}`;
    const hit = this.facadeCache.get(key);
    if (hit) return hit;
    const rnd = this.rnd;
    const N = 512;
    const cell = N / 4;
    const base = new THREE.Color(color);
    const shade = (k: number) => `#${base.clone().multiplyScalar(k).getHexString()}`;
    const [a, x] = canvas2d(N, N);
    const [e, y] = canvas2d(N, N);
    x.fillStyle = `#${base.getHexString()}`;
    x.fillRect(0, 0, N, N);
    y.fillStyle = '#000';
    y.fillRect(0, 0, N, N);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = rnd() < 0.5 ? shade(0.92) : shade(1.06);
      x.fillRect(rnd(0, N), rnd(0, N), rnd(2, 6), rnd(1, 3));
    }
    for (let r = 0; r < 4; r++) {
      x.fillStyle = shade(0.82);
      x.fillRect(0, r * cell + cell - 6, N, 3);
    }
    (this.layouts[li] ?? []).forEach((lit, i) => {
      const cx = (i % 4) * cell;
      const cy = Math.floor(i / 4) * cell;
      const wx = cx + cell * 0.28;
      const wy = cy + cell * 0.18;
      const ww = cell * 0.44;
      const wh = cell * 0.56;
      x.fillStyle = shade(1.18);
      x.fillRect(wx - 6, wy - 10, ww + 12, 8);
      x.fillStyle = '#f4efe6';
      x.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      x.fillStyle = lit ?? '#1c2238';
      x.fillRect(wx, wy, ww, wh);
      if (lit) {
        x.fillStyle = 'rgba(120,60,40,.35)';
        x.fillRect(wx, wy, ww * 0.22, wh);
        x.fillRect(wx + ww * 0.78, wy, ww * 0.22, wh);
      }
      x.fillStyle = '#f4efe6';
      x.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      x.fillRect(wx, wy + wh * 0.4 - 2, ww, 4);
      x.fillStyle = shade(0.7);
      x.fillRect(wx - 8, wy + wh + 4, ww + 16, 6);
      if (lit) {
        const g = y.createRadialGradient(
          wx + ww / 2,
          wy + wh / 2,
          2,
          wx + ww / 2,
          wy + wh / 2,
          ww * 0.9,
        );
        g.addColorStop(0, lit);
        g.addColorStop(1, '#000');
        y.fillStyle = g;
        y.fillRect(wx, wy, ww, wh);
        y.fillStyle = '#000';
        y.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        y.fillRect(wx, wy + wh * 0.4 - 2, ww, 4);
      }
    });
    const mk = (c: HTMLCanvasElement) => {
      const t = srgbTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    };
    const out = { map: mk(a), em: mk(e) };
    this.facadeCache.set(key, out);
    return out;
  }

  facade(color: THREE.ColorRepresentation, w: number, h: number): THREE.MeshStandardMaterial {
    const layout = Math.floor(this.rnd(0, 3));
    const rx = Math.max(0.5, Math.round(w * 2.4) / 4);
    const ry = Math.max(0.5, Math.round(h * 2.4) / 4);
    const key = `${String(color)}/${layout}/${rx}/${ry}`;
    const hit = this.facadeMaterials.get(key);
    if (hit) return hit;
    const { map, em } = this.facadeTextures(color, layout);
    const m = map.clone();
    const e = em.clone();
    m.needsUpdate = e.needsUpdate = true;
    m.repeat.set(rx, ry);
    e.repeat.set(rx, ry);
    const mat = T(0xffffff, {
      map: m,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: e,
      emissiveIntensity: 1.3,
      roughness: 0.85,
    });
    this.facadeMaterials.set(key, mat);
    return mat;
  }

  /** A building block with facade sides, a snowy roof, cornice and plinth. */
  snowBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    o: MeshOptions & { plain?: boolean } = {},
  ): THREE.Mesh {
    const side = o.plain ? T(color) : this.facade(color, w, h);
    const m = this.mesh(B(w, h, d), [side, side, SNOW, SNOW, side, side], x, y + h / 2, z, o);
    if (!o.plain && w > 0.15 && d > 0.15) {
      const trim = T(new THREE.Color(color).multiplyScalar(0.75).getHex());
      this.mesh(B(w + 0.03, 0.025, d + 0.03), trim, 0, h / 2 - 0.012, 0, { parent: m });
      this.mesh(B(w + 0.02, 0.04, d + 0.02), trim, 0, -h / 2 + 0.02, 0, { parent: m });
      this.mesh(B(w + 0.035, 0.012, d + 0.035), SNOW, 0, h / 2 + 0.004, 0, { parent: m });
    }
    return m;
  }

  gableHouse(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: THREE.ColorRepresentation,
    roofColor: THREE.ColorRepresentation,
    o: GableOptions = {},
  ): THREE.Group {
    const g = this.group(x, o.y ?? 0.13, z, o.parent);
    if (o.ry) g.rotation.y = o.ry;
    this.snowBox(0, 0, 0, w, h, d, color, { parent: g });
    const rh = w * 0.55;
    this.mesh(prism(w * 1.12, rh + 0.03, d * 1.08), T(roofColor), 0, h - 0.02, 0, { parent: g });
    this.mesh(prism(w, rh, d * 1.1), SNOW, 0, h + 0.02, 0, { parent: g });
    if (o.steps) {
      for (const [k, i] of [
        [0.85, 0],
        [0.6, 1],
        [0.35, 2],
      ] as const) {
        this.mesh(B(w * k, 0.08, 0.05), T(color), 0, h + 0.04 + i * 0.08, d / 2 + 0.01, {
          parent: g,
        });
      }
    }
    if (o.chimney !== false) {
      this.mesh(B(0.06, 0.16, 0.06), T(0x7a3b2e), w * 0.25, h + rh * 0.55, -d * 0.15, {
        parent: g,
      });
    }
    this.mesh(
      B(w * 0.28, h * 0.32, 0.02),
      T(0x5a3420, GLOW(0xffb35a, 0.35)),
      0,
      h * 0.16,
      d / 2 + 0.011,
      { parent: g },
    );
    return g;
  }

  /** A small coloured light with a halo; blinks with the shared bulb materials. */
  bulb(x: number, y: number, z: number, i: number, r = 0.035, parent?: THREE.Object3D) {
    const k = i % 4;
    const m = new THREE.Mesh(this.bulbGeo, this.bulbMats[k]);
    const halo = new THREE.Sprite(this.haloMats[k]);
    halo.scale.setScalar(6);
    m.add(halo);
    m.scale.setScalar(r);
    m.position.set(x, y, z);
    (parent ?? this.root).add(m);
    return m;
  }

  warm(x: number, y: number, z: number, c: THREE.ColorRepresentation, i = 1.4, d = 4): void {
    const l = new THREE.PointLight(c, i, d);
    l.position.set(x, y, z);
    this.root.add(l);
  }

  tree(x: number, z: number, s = 1, lights = false): THREE.Group {
    const g = this.group(x, 0.13, z);
    g.scale.setScalar(s);
    this.mesh(CYL(0.04, 0.05, 0.14, 6), T(0x6b4226), 0, 0.07, 0, { parent: g });
    for (const [r, h, y] of [
      [0.24, 0.32, 0.2],
      [0.19, 0.28, 0.38],
      [0.13, 0.24, 0.54],
    ] as const) {
      this.mesh(new THREE.ConeGeometry(r, h, 32, 3), T(0x2e9e64), 0, y, 0, { parent: g });
      this.mesh(new THREE.ConeGeometry(r * 0.62, h * 0.45, 32), SNOW, 0, y + h * 0.3, 0, {
        parent: g,
      });
    }
    if (lights) {
      for (let i = 0; i < 14; i++) {
        const t = i / 14;
        const a = t * Math.PI * 5;
        const r = 0.22 * (1 - t * 0.7);
        this.bulb(Math.cos(a) * r, 0.12 + t * 0.55, Math.sin(a) * r, i, 0.022, g);
      }
      this.mesh(new THREE.OctahedronGeometry(0.05), BASIC(0xffe066), 0, 0.72, 0, { parent: g });
    }
    return g;
  }

  /** Blink the shared bulb materials. */
  animateBulbs(time: number): void {
    this.bulbMats.forEach((m, i) => {
      const k = 0.55 + 0.45 * Math.sin(time * 4 + i * 1.57);
      m.color.setHex(BULB_COLORS[i] ?? 0xffffff).multiplyScalar(k);
      const halo = this.haloMats[i];
      if (halo) {
        halo.opacity = k;
        for (const p of this.linkedHalos.get(halo) ?? []) p.opacity = k;
      }
    });
  }
}
