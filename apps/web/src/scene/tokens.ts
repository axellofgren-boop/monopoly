/**
 * Player token models. Each model faces +x (the direction of travel), stands on y = 0 and is
 * scaled to fit a tile. The Dala horse, kanelbulle and moose are ported from the approved look.
 */
import * as THREE from 'three';
import type { Token } from '@hometown/protocol';
import { B, BASIC, CYL, T, capsule, ellipsoid } from './builder.js';
import type { Builder } from './builder.js';
import { buildVasa } from './city.js';

/** Largest footprint and height of a token on a tile, in world units. */
const FOOTPRINT = 0.42;
const MAX_HEIGHT = 0.6;

function dalahast(b: Builder, d: THREE.Group): void {
  const sh = new THREE.Shape();
  sh.moveTo(-0.2, 0);
  sh.lineTo(-0.06, 0);
  sh.quadraticCurveTo(0, 0.1, 0.06, 0);
  sh.lineTo(0.2, 0);
  sh.lineTo(0.17, 0.2);
  sh.quadraticCurveTo(0.25, 0.28, 0.21, 0.36);
  sh.lineTo(0.27, 0.45);
  sh.quadraticCurveTo(0.34, 0.44, 0.35, 0.49);
  sh.quadraticCurveTo(0.36, 0.56, 0.29, 0.57);
  sh.lineTo(0.23, 0.62);
  sh.lineTo(0.21, 0.67);
  sh.lineTo(0.17, 0.6);
  sh.quadraticCurveTo(0.1, 0.56, 0.07, 0.42);
  sh.quadraticCurveTo(0, 0.37, -0.14, 0.38);
  sh.quadraticCurveTo(-0.25, 0.4, -0.27, 0.33);
  sh.lineTo(-0.31, 0.27);
  sh.quadraticCurveTo(-0.26, 0.22, -0.21, 0.24);
  sh.lineTo(-0.2, 0);
  const body = new THREE.ExtrudeGeometry(sh, {
    depth: 0.07,
    bevelEnabled: true,
    bevelSize: 0.028,
    bevelThickness: 0.035,
    bevelSegments: 5,
    curveSegments: 16,
  });
  body.translate(0, 0, -0.035);
  b.mesh(body, T(0xb80f18, { roughness: 0.45 }), 0, 0, 0, { parent: d });
  const flat = (
    r: number,
    sx: number,
    sy: number,
    col: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const g = new THREE.CylinderGeometry(r, r, 0.006, 24);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    b.mesh(g, T(col), x, y, z, { parent: d });
  };
  for (const s of [1, -1]) {
    const z = s * 0.072;
    flat(0.085, 1.25, 1, 0xffffff, -0.04, 0.29, z);
    flat(0.07, 1.25, 1, 0x1f6fd1, -0.04, 0.29, z + s * 0.002);
    flat(0.035, 1.6, 0.6, 0xffd02e, -0.04, 0.29, z + s * 0.004);
    for (const [x, y, c] of [
      [-0.16, 0.3, 0x2e9e64],
      [0.07, 0.33, 0x2e9e64],
      [-0.04, 0.2, 0xffd02e],
      [-0.12, 0.2, 0xffffff],
      [0.04, 0.2, 0xffffff],
    ] as const) {
      flat(0.016, 1, 1, c, x, y, z);
    }
    flat(0.018, 1, 1, 0xffffff, 0.26, 0.53, z * 0.92);
    flat(0.009, 1, 1, 0x111111, 0.262, 0.532, z * 0.92 + s * 0.002);
    const br = new THREE.TorusGeometry(0.055, 0.008, 6, 18, Math.PI);
    b.mesh(br, T(0xffffff), 0.29, 0.5, z * 0.9, { parent: d, rz: -0.9 });
  }
}

function kanelbulle(b: Builder, k: THREE.Group): void {
  b.mesh(new THREE.TorusGeometry(0.14, 0.075, 16, 40), T(0xc8853f), 0, 0.09, 0, {
    parent: k,
    rx: Math.PI / 2,
  });
  b.mesh(new THREE.TorusGeometry(0.07, 0.05, 8, 18), T(0xb06a2c), 0, 0.15, 0, {
    parent: k,
    rx: Math.PI / 2,
  });
  b.mesh(new THREE.SphereGeometry(0.05, 10, 8), T(0xd8964f), 0, 0.17, 0, { parent: k });
  const sugar = T(0xffffff);
  for (let i = 0; i < 14; i++) {
    const a = b.rnd(0, Math.PI * 2);
    const r = b.rnd(0.04, 0.2);
    b.mesh(B(0.02, 0.02, 0.02), sugar, Math.cos(a) * r, 0.17 + b.rnd(0, 0.02), Math.sin(a) * r, {
      parent: k,
      ry: a,
    });
  }
}

function alg(b: Builder, m: THREE.Group): void {
  const fur = T(0x7a4a2a);
  const dark = T(0x4a2c18);
  const ant = T(0xf0d29a);
  b.mesh(ellipsoid(0.13, 1.35, 0.85, 0.8), fur, 0, 0.33, 0, { parent: m });
  b.mesh(ellipsoid(0.08, 1.2, 1, 0.9), fur, 0.08, 0.42, 0, { parent: m });
  for (const [x, z] of [
    [-0.1, 0.05],
    [0.1, 0.05],
    [-0.1, -0.05],
    [0.1, -0.05],
  ] as const) {
    b.mesh(capsule(0.025, 0.17), dark, x, 0.13, z, { parent: m });
  }
  b.mesh(capsule(0.045, 0.09), fur, 0.15, 0.45, 0, { parent: m, rz: -0.8 });
  b.mesh(ellipsoid(0.07, 1.45, 0.85, 0.85), fur, 0.24, 0.5, 0, { parent: m, rz: -0.35 });
  b.mesh(new THREE.SphereGeometry(0.045, 14, 10), dark, 0.32, 0.46, 0, { parent: m });
  b.mesh(new THREE.SphereGeometry(0.028, 12, 8), fur, 0.2, 0.4, 0, { parent: m });
  for (const s of [1, -1]) {
    b.mesh(ellipsoid(0.025, 0.6, 1.4, 0.6), fur, 0.19, 0.57, s * 0.045, { parent: m, rx: s * 0.4 });
    b.mesh(new THREE.SphereGeometry(0.013, 10, 8), T(0x111111), 0.27, 0.53, s * 0.05, {
      parent: m,
    });
    b.mesh(new THREE.SphereGeometry(0.005, 6, 4), BASIC(0xffffff), 0.275, 0.537, s * 0.06, {
      parent: m,
    });
    const a = new THREE.Shape();
    a.moveTo(0, 0);
    a.quadraticCurveTo(0.03, 0.05, 0.02, 0.1);
    a.quadraticCurveTo(0.04, 0.13, 0.05, 0.1);
    a.quadraticCurveTo(0.07, 0.14, 0.08, 0.1);
    a.quadraticCurveTo(0.11, 0.13, 0.11, 0.08);
    a.quadraticCurveTo(0.1, 0.02, 0.03, -0.01);
    a.lineTo(0, 0);
    const ag = new THREE.ExtrudeGeometry(a, {
      depth: 0.008,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      bevelSegments: 3,
      curveSegments: 10,
    });
    const am = b.mesh(ag, ant, 0.2, 0.57, s * 0.04, { parent: m });
    am.rotation.set(s * -1.1, s > 0 ? 0 : Math.PI, 0.15);
  }
}

function vasaskepp(b: Builder, g: THREE.Group): void {
  buildVasa(b, b.group(0, 0.05, 0, g));
}

/** A small Viking: tunic, beard, horned helmet and a blue-and-yellow round shield. */
function viking(b: Builder, g: THREE.Group): void {
  const skin = T(0xf2c4a0);
  const tunic = T(0x2f5fd0, { roughness: 0.8 });
  const metal = T(0xb8c0cc, { roughness: 0.35, metalness: 0.7 });
  const horn = T(0xf3e6c8, { roughness: 0.5 });
  b.mesh(CYL(0.11, 0.15, 0.06, 32), T(0x4a3020), 0, 0.03, 0, { parent: g });
  b.mesh(capsule(0.1, 0.14, 24), tunic, 0, 0.2, 0, { parent: g });
  b.mesh(CYL(0.105, 0.105, 0.025, 32), T(0x6b4226), 0, 0.17, 0, { parent: g });
  b.mesh(new THREE.SphereGeometry(0.085, 32, 24), skin, 0, 0.4, 0, { parent: g });
  b.mesh(ellipsoid(0.06, 1, 1.2, 1.3), T(0xe0782a), 0.05, 0.35, 0, { parent: g });
  for (const s of [1, -1]) {
    b.mesh(new THREE.SphereGeometry(0.011, 10, 8), T(0x111111), 0.075, 0.42, s * 0.03, {
      parent: g,
    });
  }
  b.mesh(
    new THREE.SphereGeometry(0.092, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    metal,
    0,
    0.42,
    0,
    { parent: g },
  );
  b.mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 32), metal, 0, 0.42, 0, {
    parent: g,
    rx: Math.PI / 2,
  });
  for (const s of [1, -1]) {
    const h = b.mesh(new THREE.ConeGeometry(0.022, 0.12, 16), horn, 0, 0.5, s * 0.1, { parent: g });
    h.rotation.x = s * -0.9;
  }
  const shield = b.group(-0.02, 0.22, 0.12, g);
  b.mesh(CYL(0.09, 0.09, 0.02, 32), T(0x1f5fbf), 0, 0, 0, { parent: shield, rx: Math.PI / 2 });
  b.mesh(B(0.18, 0.03, 0.022), T(0xffd02e), 0, 0, 0.002, { parent: shield });
  b.mesh(B(0.03, 0.18, 0.022), T(0xffd02e), -0.03, 0, 0.002, { parent: shield });
  b.mesh(new THREE.SphereGeometry(0.02, 12, 8), metal, 0, 0, 0.014, { parent: shield });
}

/** A coffee cup on a saucer with a little rising steam. */
function fika(b: Builder, g: THREE.Group): void {
  const china = T(0xffffff, { roughness: 0.25 });
  const accent = T(0x36d68b, { roughness: 0.4 });
  b.mesh(CYL(0.16, 0.13, 0.02, 48), china, 0, 0.01, 0, { parent: g });
  b.mesh(new THREE.TorusGeometry(0.15, 0.006, 8, 48), accent, 0, 0.02, 0, {
    parent: g,
    rx: Math.PI / 2,
  });
  const pts = [
    [0.0, 0.0],
    [0.06, 0.0],
    [0.075, 0.02],
    [0.09, 0.1],
    [0.1, 0.17],
    [0.094, 0.17],
    [0.085, 0.1],
    [0.0, 0.1],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  b.mesh(new THREE.LatheGeometry(pts, 48), china, 0, 0.02, 0, { parent: g });
  b.mesh(CYL(0.093, 0.093, 0.06, 48), accent, 0, 0.08, 0, { parent: g });
  b.mesh(CYL(0.088, 0.088, 0.004, 48), T(0x3b1f10, { roughness: 0.2 }), 0, 0.17, 0, { parent: g });
  b.mesh(new THREE.TorusGeometry(0.04, 0.011, 10, 24, Math.PI * 1.3), china, -0.1, 0.11, 0, {
    parent: g,
    rz: Math.PI * 0.35,
  });
  const steam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  [0.24, 0.3, 0.36].forEach((y, i) =>
    b.mesh(new THREE.SphereGeometry(0.025 + i * 0.006, 12, 8), steam, (i % 2) * 0.02, y, 0, {
      parent: g,
      shadow: false,
    }),
  );
}

const BUILDERS: Record<Token, (b: Builder, g: THREE.Group) => void> = {
  dalahast,
  kanelbulle,
  alg,
  vasaskepp,
  viking,
  fika,
};

/** Builds a token model, fitted to a tile. */
export function buildToken(b: Builder, token: Token): THREE.Group {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  outer.add(inner);
  (BUILDERS[token] ?? dalahast)(b, inner);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(FOOTPRINT / Math.max(size.x, size.z), MAX_HEIGHT / size.y);
  inner.scale.setScalar(scale);
  inner.position.y = -box.min.y * scale;
  return outer;
}
