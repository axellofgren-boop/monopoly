/**
 * The Stockholm centrepiece and the snowy surroundings, ported from the approved look (round 3).
 * Returns an animate function for the moving parts (Gröna Lund, ferries, snow, aurora).
 */
import * as THREE from 'three';
import {
  B,
  BASIC,
  BULB_COLORS,
  CYL,
  GLOW,
  SNOW,
  T,
  canvas2d,
  ellipsoid,
  haloTexture,
  srgbTexture,
} from './builder.js';
import type { Builder } from './builder.js';

export type Animate = (dt: number, time: number) => void;

export function buildCity(b: Builder): Animate {
  const rnd = b.rnd;
  const root = b.root;

  // ---------- water and islands (centre is -3.7..3.7) ----------
  const waterMat = T(0x123a70, {
    roughness: 0.25,
    metalness: 0.2,
    emissive: new THREE.Color(0x0a2a60),
    emissiveIntensity: 0.5,
  });
  b.mesh(B(7.36, 0.06, 7.36), waterMat, 0, -0.02, 0, { shadow: false });
  const landTop = T(0xd6dfef);
  const landSide = (() => {
    const [c, x] = canvas2d(512, 64);
    x.fillStyle = '#6d655e';
    x.fillRect(0, 0, 512, 64);
    const stones = ['#8f857b', '#7f766d', '#9b9187', '#857b70'];
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 20; i++) {
        const off = r % 2 ? 13 : 0;
        x.fillStyle = stones[Math.floor(rnd(0, 4))] ?? '#857b70';
        x.fillRect(i * 26 + off - 13 + 1, r * 16 + 1, 24, 14);
      }
    }
    x.fillStyle = '#e9eef6';
    x.fillRect(0, 0, 512, 6);
    const t = srgbTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(4, 1);
    return T(0xffffff, { map: t, roughness: 0.95 });
  })();
  const island = (x: number, z: number, w: number, d: number) =>
    b.mesh(B(w, 0.16, d), [landSide, landSide, landTop, landTop, landSide, landSide], x, 0.05, z);
  island(0, -2.4, 7.3, 2.5);
  island(0, 2.4, 7.3, 2.5);
  island(-0.4, 0, 2.3, 1.5);
  island(2.78, 0, 1.75, 1.4);
  const floes: [number, number][] = [
    [-2.6, -0.95],
    [-1.9, 1.0],
    [1.4, -0.95],
    [2.2, 1.0],
    [-3.2, 0.3],
    [1.0, 0.6],
    [3.4, -0.9],
    [-2.9, -0.6],
    [3.3, 1.0],
  ];
  for (const [x, z] of floes) {
    b.mesh(CYL(0.1 + rnd() * 0.08, 0.12 + rnd() * 0.08, 0.03, 7), SNOW, x, 0.02, z, {
      shadow: false,
    });
  }
  const bridge = (x: number, z: number, len: number, along: 'x' | 'z') => {
    const g = along === 'z' ? B(0.32, 0.07, len) : B(len, 0.07, 0.32);
    b.mesh(g, T(0x9aa3b8), x, 0.17, z);
    for (let i = 0; i < 3; i++) {
      const t = -len / 2 + 0.08 + (i * (len - 0.16)) / 2;
      const [bx, bz] = along === 'z' ? [x + 0.17, z + t] : [x + t, z + 0.17];
      b.mesh(CYL(0.012, 0.012, 0.16, 6), T(0x2a2f45), bx, 0.29, bz);
      b.bulb(bx, 0.38, bz, 1, 0.03);
    }
  };
  bridge(-0.4, -0.95, 0.6, 'z');
  bridge(-0.4, 0.95, 0.6, 'z');
  bridge(1.32, -0.45, 1.3, 'x');

  // ---------- Stadshuset ----------
  {
    const brick = 0xc4553a;
    const sx = -2.45;
    const sz = -1.95;
    b.snowBox(sx, 0.13, sz - 0.45, 1.55, 0.5, 0.34, brick);
    b.snowBox(sx - 0.62, 0.13, sz, 0.32, 0.5, 0.95, brick);
    b.snowBox(sx + 0.62, 0.13, sz, 0.32, 0.5, 0.95, brick);
    for (let i = 0; i < 5; i++) {
      b.mesh(
        B(0.13, 0.2, 0.03),
        T(0x2a1810, GLOW(0xffa040, 0.8)),
        sx - 0.35 + i * 0.175,
        0.23,
        sz - 0.27,
      );
    }
    const tx = -1.78;
    const tz = -1.62;
    b.snowBox(tx, 0.13, tz, 0.36, 1.55, 0.36, brick);
    b.mesh(B(0.46, 0.05, 0.46), T(0x58b39a), tx, 1.7, tz);
    b.mesh(B(0.28, 0.36, 0.28), T(0x58b39a, GLOW(0x2a8f74, 0.3)), tx, 1.9, tz);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      b.mesh(
        B(0.08, 0.16, 0.02),
        T(0x1a1a10, GLOW(0xffd36b, 1)),
        tx + Math.sin(a) * 0.141,
        1.92,
        tz + Math.cos(a) * 0.141,
        { ry: a },
      );
    }
    b.mesh(new THREE.ConeGeometry(0.2, 0.2, 4), T(0x58b39a), tx, 2.18, tz, { ry: Math.PI / 4 });
    b.mesh(CYL(0.015, 0.015, 0.25, 6), T(0xffd36b), tx, 2.4, tz);
    const goldM = T(0xffd36b, GLOW(0xffb000, 0.7));
    for (const [dx, dy] of [
      [0, 0.62],
      [-0.11, 0.5],
      [0.11, 0.5],
    ] as const) {
      const crown = b.group(tx + dx, 1.92 + dy, tz);
      b.mesh(new THREE.TorusGeometry(0.055, 0.018, 6, 14), goldM, 0, 0, 0, {
        parent: crown,
        rx: Math.PI / 2,
      });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.mesh(
          new THREE.ConeGeometry(0.018, 0.06, 4),
          goldM,
          Math.cos(a) * 0.055,
          0.035,
          Math.sin(a) * 0.055,
          { parent: crown },
        );
      }
      b.mesh(new THREE.SphereGeometry(0.02, 8, 6), goldM, 0, 0.08, 0, { parent: crown });
    }
    b.warm(tx, 1.4, tz + 0.8, 0xffa860, 1.6, 3.5);
  }
  // Stadshuset corner turrets
  {
    const copper = T(0x58b39a, { roughness: 0.5, metalness: 0.3 });
    const gold = T(0xffd36b, {
      roughness: 0.3,
      metalness: 0.8,
      emissive: new THREE.Color(0xffb000),
      emissiveIntensity: 0.3,
    });
    for (const [x, z] of [
      [-3.2, -2.4],
      [-1.72, -2.4],
      [-3.2, -1.5],
    ] as const) {
      b.snowBox(x, 0.13, z, 0.14, 0.72, 0.14, 0xc4553a);
      b.mesh(new THREE.ConeGeometry(0.1, 0.26, 4), copper, x, 0.98, z, { ry: Math.PI / 4 });
      b.mesh(new THREE.SphereGeometry(0.018, 16, 12), gold, x, 1.13, z);
    }
    for (let i = 0; i < 6; i++) {
      b.mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.2, 12),
        T(0xe8d8c0),
        -2.85 + i * 0.17,
        0.23,
        -1.66,
      );
    }
  }
  // quay promenades: lamp posts with warm halos
  {
    const post = T(0x232a3d, { roughness: 0.4, metalness: 0.6 });
    const lampM = BASIC(0xffe2a0);
    const halo = new THREE.SpriteMaterial({
      map: haloTexture,
      color: 0xffcf80,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lamp = (x: number, z: number) => {
      b.mesh(CYL(0.01, 0.014, 0.34, 10), post, x, 0.3, z);
      b.mesh(CYL(0.03, 0.02, 0.04, 12), post, x, 0.48, z);
      const bulb = b.mesh(new THREE.SphereGeometry(0.022, 16, 12), lampM, x, 0.45, z, {
        shadow: false,
      });
      const h = new THREE.Sprite(halo);
      h.scale.setScalar(0.35);
      bulb.add(h);
    };
    for (let x = -1.3; x <= 3.4; x += 0.5) lamp(x, -1.22);
    for (let x = -3.4; x <= 1.3; x += 0.5) lamp(x, 1.22);
    for (let z = -0.6; z <= 0.6; z += 0.4) lamp(1.97, z);
  }

  // ---------- Kaknästornet ----------
  {
    const kx = 3.05;
    const kz = -3.0;
    const conc = T(0xd7d9e2);
    b.mesh(CYL(0.12, 0.2, 3.0, 4), conc, kx, 1.62, kz, { ry: Math.PI / 4 });
    for (const s of [-1, 1]) {
      b.mesh(B(0.04, 2.9, 0.06), T(0xbcc0cc), kx + s * 0.15, 1.6, kz);
      b.mesh(B(0.06, 2.9, 0.04), T(0xbcc0cc), kx, 1.6, kz + s * 0.15);
    }
    b.snowBox(kx, 3.05, kz, 0.5, 0.42, 0.5, 0x9aa4b8);
    b.mesh(B(0.56, 0.06, 0.56), T(0xd7d9e2), kx, 3.5, kz);
    b.snowBox(kx, 3.53, kz, 0.36, 0.18, 0.36, 0x9aa4b8);
    b.mesh(CYL(0.025, 0.03, 0.8, 8), T(0xe8e8f0), kx, 4.1, kz);
    for (const h of [0.3, 0.55]) b.mesh(CYL(0.06, 0.06, 0.03, 8), T(0xff4455), kx, 3.8 + h, kz);
  }
  const kakLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), BASIC(0xff3344));
  kakLight.position.set(3.05, 4.53, -3.0);
  root.add(kakLight);

  // ---------- Sergels torg ----------
  {
    const [c, x] = canvas2d(128, 128);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        x.fillStyle = (i + j) % 2 ? '#1a1a22' : '#f3f3f6';
        x.beginPath();
        x.moveTo(i * 16, j * 16);
        x.lineTo(i * 16 + 16, j * 16);
        x.lineTo(i * 16 + (j % 2 ? 16 : 0), j * 16 + 16);
        x.fill();
        x.fillStyle = (i + j) % 2 ? '#f3f3f6' : '#1a1a22';
        x.beginPath();
        x.moveTo(i * 16 + (j % 2 ? 0 : 16), j * 16 + 16);
        x.lineTo(i * 16, j * 16 + 16);
        x.lineTo(i * 16 + 16, j * 16 + 16);
        x.lineTo(i * 16 + (j % 2 ? 16 : 0), j * 16);
        x.fill();
      }
    }
    b.mesh(CYL(0.5, 0.5, 0.03, 32), T(0xffffff, { map: srgbTexture(c) }), 0.75, 0.145, -1.75);
    b.mesh(
      CYL(0.09, 0.13, 1.5, 4),
      new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.9 }),
      0.75,
      0.9,
      -1.75,
      { ry: Math.PI / 4 },
    );
    b.mesh(CYL(0.6, 0.6, 0.06, 32), T(0x4a5a7a), 0.75, 0.15, -1.75).scale.set(1, 0.5, 1);
    b.warm(0.75, 1.2, -1.75, 0x7fd8ff, 1.5, 3);
  }

  // Norrmalm skyline
  const skyline: [number, number, number, number, number, number][] = [
    [-0.6, -3.2, 0.5, 0.45, 1.25, 0x5b7bff],
    [-0.05, -3.25, 0.45, 0.5, 1.75, 0xff6fae],
    [0.55, -3.2, 0.5, 0.45, 1.1, 0x36d6b0],
    [1.15, -3.25, 0.45, 0.45, 1.45, 0xffa83d],
    [1.75, -3.15, 0.5, 0.5, 0.95, 0x8f6bff],
    [-0.55, -2.5, 0.42, 0.42, 0.8, 0xff8a5c],
    [1.6, -2.4, 0.45, 0.42, 0.75, 0x4fc3ff],
    [2.2, -2.6, 0.4, 0.4, 1.05, 0xff5f7a],
    [-1.1, -2.85, 0.35, 0.5, 0.6, 0xffd04d],
  ];
  for (const [x, z, w, d, h, c] of skyline) {
    b.snowBox(x, 0.13, z, w, h, d, c);
    if (h > 1.2) {
      b.mesh(B(w * 0.6, 0.18, d * 0.6), T(c), x, 0.13 + h + 0.09, z);
      b.mesh(CYL(0.01, 0.01, 0.3, 4), T(0xffffff), x, 0.13 + h + 0.33, z);
      b.bulb(x, 0.13 + h + 0.5, z, 0, 0.03);
    }
  }
  // Kungsholmen houses
  for (const [x, z, c] of [
    [-3.35, -3.25, 0xffb84d],
    [-2.85, -3.3, 0x4fc3ff],
    [-2.35, -3.25, 0xff6f9a],
    [-1.85, -3.3, 0x7fe0a0],
  ] as const) {
    b.gableHouse(x, z, 0.4, 0.36, 0.45, c, 0x3a4a8a);
  }

  // Kungliga slottet
  {
    const px = -0.62;
    const pz = -0.32;
    const c = 0xe6c27a;
    b.snowBox(px, 0.13, pz - 0.26, 1.05, 0.36, 0.2, c);
    b.snowBox(px, 0.13, pz + 0.26, 1.05, 0.36, 0.2, c);
    b.snowBox(px - 0.43, 0.13, pz, 0.2, 0.36, 0.32, c);
    b.snowBox(px + 0.43, 0.13, pz, 0.2, 0.36, 0.32, c);
    for (const [dx, dz] of [
      [-0.52, -0.26],
      [0.52, -0.26],
      [-0.52, 0.26],
      [0.52, 0.26],
    ] as const) {
      b.mesh(B(0.06, 0.2, 0.06), T(0xffd36b, GLOW(0xffd36b, 0.5)), px + dx, 0.6, pz + dz);
    }
    b.mesh(B(0.18, 0.1, 0.01), T(0x1f6fd1), px + 0.09, 0.98, pz - 0.26);
    b.mesh(B(0.18, 0.025, 0.012), T(0xffd02e), px + 0.09, 0.98, pz - 0.26);
    b.mesh(B(0.025, 0.1, 0.012), T(0xffd02e), px + 0.05, 0.98, pz - 0.26);
    b.mesh(CYL(0.008, 0.008, 0.5, 4), T(0xffffff), px, 0.75, pz - 0.26);
    b.warm(px, 1.0, pz + 0.6, 0xffc070, 1.3, 2.6);
  }
  // Gamla stan step-gable houses
  [0xffa63d, 0xffd34d, 0xff6f5c, 0xff9ec2, 0x8fd96b, 0xffb86b].forEach((c, i) =>
    b.gableHouse(-1.38 + i * 0.26, 0.42, 0.24, 0.34, 0.42 + (i % 3) * 0.08, c, 0x8a3a2a, {
      steps: true,
      chimney: i % 2 === 0,
    }),
  );
  // Storkyrkan tower
  {
    const x = 0.2;
    const z = 0.25;
    b.snowBox(x, 0.13, z, 0.2, 0.75, 0.2, 0xe9b37a, { plain: true });
    b.mesh(
      new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      T(0x58b39a),
      x,
      0.88,
      z,
    );
    b.mesh(new THREE.ConeGeometry(0.04, 0.25, 6), T(0x58b39a), x, 1.12, z);
    b.mesh(B(0.08, 0.12, 0.02), T(0x111111, GLOW(0xffd36b, 1)), x, 0.6, z + 0.105);
  }
  // Riddarholmskyrkan with iron openwork spire
  {
    const x = 0.48;
    const z = -0.38;
    b.snowBox(x, 0.13, z, 0.26, 0.42, 0.42, 0xb84a32, { plain: true });
    b.mesh(new THREE.ConeGeometry(0.12, 1.25, 8, 10, true), T(0x2a3350), x, 1.17, z);
    const wf = new THREE.Mesh(
      new THREE.ConeGeometry(0.125, 1.26, 8, 6, true),
      new THREE.MeshBasicMaterial({ color: 0x8fa8d8, wireframe: true }),
    );
    wf.position.set(x, 1.17, z);
    root.add(wf);
    b.warm(x, 0.9, z + 0.5, 0x9fb8ff, 1, 2);
  }

  // Globen
  {
    const gx = 2.3;
    const gz = 2.55;
    const dome = new THREE.SphereGeometry(0.85, 96, 56, 0, Math.PI * 2, 0, Math.PI * 0.58);
    b.mesh(dome, T(0xf5f8ff, GLOW(0x9fd6ff, 0.35)), gx, 0.05, gz);
    const lat = new THREE.Mesh(
      new THREE.SphereGeometry(0.862, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshBasicMaterial({ color: 0x6fb8ff, wireframe: true }),
    );
    lat.position.set(gx, 0.05, gz);
    root.add(lat);
    b.mesh(B(0.5, 0.18, 0.3), b.facade(0x5b7bff, 0.5, 0.18), gx - 0.65, 0.22, gz - 0.55, {
      ry: 0.7,
    });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      b.bulb(gx + Math.cos(a) * 0.78, 0.38, gz + Math.sin(a) * 0.78, i, 0.035);
    }
    b.warm(gx, 1.6, gz, 0x9fd6ff, 1.8, 3.5);
  }
  // Södermalm blocks
  const soder: [number, number, number][] = [
    [-3.3, 1.6, 0xff6f9a],
    [-2.85, 1.6, 0xffd34d],
    [-2.4, 1.6, 0x4fc3ff],
    [-1.95, 1.6, 0xff9a3d],
    [-3.3, 2.25, 0x7fe0a0],
    [-2.4, 2.3, 0xc49bff],
    [-3.3, 2.95, 0xffb86b],
    [-2.85, 3.0, 0xff5f7a],
    [-0.9, 1.6, 0x5b7bff],
    [-0.45, 1.6, 0xffd34d],
    [0, 1.6, 0xff7f50],
    [0.45, 1.6, 0x36d6b0],
    [-0.45, 2.95, 0xff9ec2],
    [0.1, 3.0, 0x8f6bff],
    [0.9, 3.25, 0xffa63d],
  ];
  soder.forEach(([x, z, c], i) => b.gableHouse(x, z, 0.36, 0.4, 0.5 + (i % 3) * 0.12, c, 0x34407a));
  b.tree(-1.55, 2.6, 2.4, true);

  // ---------- Djurgården: Vasa + Gröna Lund ----------
  buildVasa(b, b.group(1.32, 0.06, 0.25)).rotation.y = Math.PI / 2;

  const wheel = b.group(3.25, 1.0, 0.25);
  wheel.rotation.y = -0.5;
  const cabins: THREE.Mesh[] = [];
  {
    const rim = T(0xff6fae, GLOW(0xff3f8f, 0.5));
    b.mesh(new THREE.TorusGeometry(0.55, 0.03, 16, 96), rim, 0, 0, 0, { parent: wheel });
    b.mesh(new THREE.TorusGeometry(0.4, 0.015, 6, 32), rim, 0, 0, 0, { parent: wheel });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const color = BULB_COLORS[i % 4] ?? 0xffffff;
      b.mesh(B(0.012, 1.1, 0.012), T(0xffffff), 0, 0, 0, { parent: wheel, rz: a });
      cabins.push(
        b.mesh(
          ellipsoid(0.06, 1, 1.15, 1),
          T(color, GLOW(color, 0.6)),
          Math.cos(a) * 0.55,
          Math.sin(a) * 0.55,
          0,
          {
            parent: wheel,
          },
        ),
      );
      b.bulb(Math.cos(a + 0.31) * 0.55, Math.sin(a + 0.31) * 0.55, 0.04, i, 0.025, wheel);
    }
    const legM = T(0xe8ecf6);
    for (const s of [-1, 1]) {
      b.mesh(
        B(0.04, 1.2, 0.04),
        legM,
        3.25 + s * 0.22 * Math.cos(0.5),
        0.55,
        0.25 + s * 0.22 * Math.sin(0.5),
        {
          rz: s * 0.18,
          ry: -0.5,
        },
      );
    }
  }
  const carousel = b.group(2.62, 0.13, -0.32);
  {
    b.mesh(CYL(0.3, 0.32, 0.06, 20), T(0xffd34d), 0, 0.03, 0, { parent: carousel });
    const [c, x] = canvas2d(128, 8);
    for (let i = 0; i < 16; i++) {
      x.fillStyle = i % 2 ? '#ff4f7a' : '#ffffff';
      x.fillRect(i * 8, 0, 8, 8);
    }
    b.mesh(
      new THREE.ConeGeometry(0.36, 0.26, 16),
      T(0xffffff, { map: srgbTexture(c) }),
      0,
      0.5,
      0,
      {
        parent: carousel,
      },
    );
    b.mesh(CYL(0.04, 0.04, 0.36, 8), T(0xffd34d), 0, 0.24, 0, { parent: carousel });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.mesh(
        CYL(0.008, 0.008, 0.34, 4),
        T(0xffd34d),
        Math.cos(a) * 0.22,
        0.24,
        Math.sin(a) * 0.22,
        {
          parent: carousel,
        },
      );
      b.mesh(
        ellipsoid(0.045, 1.4, 0.8, 0.6),
        T(BULB_COLORS[i % 4] ?? 0xffffff),
        Math.cos(a) * 0.22,
        0.18,
        Math.sin(a) * 0.22,
        {
          parent: carousel,
          ry: -a,
        },
      );
      b.bulb(Math.cos(a) * 0.34, 0.38, Math.sin(a) * 0.34, i, 0.025, carousel);
    }
  }
  const dropRing = b.group();
  {
    const dx = 2.15;
    const dz = 0.45;
    b.mesh(CYL(0.04, 0.05, 1.9, 8), T(0xe8ecf6), dx, 1.08, dz);
    b.mesh(new THREE.ConeGeometry(0.07, 0.15, 8), T(0xff4747), dx, 2.1, dz);
    dropRing.position.set(dx, 1, dz);
    b.mesh(CYL(0.13, 0.13, 0.06, 12), T(0x5b7bff, GLOW(0x5b7bff, 0.6)), 0, 0, 0, {
      parent: dropRing,
    });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.bulb(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13, i, 0.02, dropRing);
    }
  }
  b.warm(2.8, 1.2, 0.3, 0xff6fae, 1.6, 3);
  b.tree(2.25, -0.48, 0.9);
  b.tree(3.55, -0.55, 0.8);
  b.tree(2.0, 0.0, 0.75);
  const islandTrees: [number, number][] = [
    [-3.4, -1.45],
    [-1.2, -1.4],
    [0.15, -1.45],
    [2.5, -1.5],
    [3.4, -1.9],
    [2.3, -3.4],
    [-3.4, 1.4],
    [-2.0, 3.35],
    [1.4, 1.5],
    [3.4, 1.5],
    [-0.95, -0.55],
  ];
  islandTrees.forEach(([x, z], i) => b.tree(x, z, 0.65 + (i % 3) * 0.12, i % 4 === 0));

  // ---------- ferries ----------
  const ferry = () => {
    const g = b.group();
    b.mesh(B(0.42, 0.09, 0.15), T(0xffffff), 0, 0.06, 0, { parent: g });
    b.mesh(B(0.42, 0.025, 0.145), T(0x1f3f8f), 0, 0.03, 0, { parent: g });
    b.mesh(B(0.26, 0.08, 0.11), b.facade(0xf3f3f8, 0.26, 0.08), -0.02, 0.14, 0, { parent: g });
    b.mesh(CYL(0.025, 0.025, 0.1, 8), T(0x111111), 0.06, 0.23, 0, { parent: g });
    b.mesh(CYL(0.026, 0.026, 0.025, 8), T(0xffffff), 0.06, 0.26, 0, { parent: g });
    b.bulb(0.2, 0.12, 0, 1, 0.02, g);
    return g;
  };
  const ferries = [
    { g: ferry(), z: -0.95, a: 0.1, b: 3.4, s: 0.25, t: 0.2 },
    { g: ferry(), z: 0.95, a: -3.4, b: -0.85, s: 0.22, t: 0.7 },
  ];
  for (const f of ferries) f.g.position.set((f.a + f.b) / 2, 0.02, f.z);

  // ---------- surroundings ----------
  const cottages: [number, number, number][] = [
    [-7, -4, 0.6],
    [-7.5, 2, 1.2],
    [7.4, -3.5, -0.4],
    [-3, -7.4, 0.2],
    [2.8, 7.6, 2.8],
    [-5, 7, 2.2],
    [6.6, -6.4, -0.8],
  ];
  for (const [x, z, r] of cottages) {
    const g = b.gableHouse(x, z, 0.8, 0.6, 0.45, 0xb3261e, 0x2a2f45, { ry: r, y: -0.5 });
    b.mesh(B(0.82, 0.04, 0.62), T(0xffffff), 0, 0.45, 0, { parent: g });
  }
  for (let i = 0; i < 60; i++) {
    const a = rnd(0, Math.PI * 2);
    const r = rnd(7, 20);
    b.tree(Math.cos(a) * r, Math.sin(a) * r, rnd(1.3, 2.4), i % 9 === 0).position.y = -0.5;
  }
  for (const [x, z] of [
    [-6.3, 4.8],
    [6.2, 5.6],
  ] as const) {
    const g = b.group(x, -0.5, z);
    b.mesh(new THREE.SphereGeometry(0.3, 40, 28), SNOW, 0, 0.28, 0, { parent: g });
    b.mesh(new THREE.SphereGeometry(0.21, 40, 28), SNOW, 0, 0.7, 0, { parent: g });
    b.mesh(new THREE.SphereGeometry(0.15, 40, 28), SNOW, 0, 1.0, 0, { parent: g });
    b.mesh(new THREE.ConeGeometry(0.04, 0.2, 8), T(0xff8a2a), 0, 1.0, 0.2, {
      parent: g,
      rx: Math.PI / 2,
    });
    b.mesh(CYL(0.12, 0.12, 0.16, 12), T(0x2a2f45), 0, 1.2, 0, { parent: g });
    b.mesh(CYL(0.18, 0.18, 0.02, 12), T(0x2a2f45), 0, 1.12, 0, { parent: g });
    b.mesh(new THREE.TorusGeometry(0.17, 0.04, 6, 16), T(0xff4747), 0, 0.85, 0, {
      parent: g,
      rx: Math.PI / 2,
    });
  }
  // stars
  {
    const g = new THREE.BufferGeometry();
    const p: number[] = [];
    for (let i = 0; i < 700; i++) {
      const a = rnd(0, Math.PI * 2);
      const e = rnd(0.12, 1.4);
      const r = 90;
      p.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    root.add(
      new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false })),
    );
  }
  // northern lights
  const auroraTex = (() => {
    const [c, x] = canvas2d(512, 128);
    for (let i = 0; i < 512; i += 2) {
      const h = 60 + 40 * Math.sin(i / 37) + 20 * Math.sin(i / 11);
      const g = x.createLinearGradient(0, 128, 0, 128 - h);
      g.addColorStop(0, 'rgba(80,255,170,0)');
      g.addColorStop(0.25, 'rgba(80,255,170,.55)');
      g.addColorStop(0.7, 'rgba(140,110,255,.35)');
      g.addColorStop(1, 'rgba(255,90,200,0)');
      x.fillStyle = g;
      x.fillRect(i, 128 - h, 2, h);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    return t;
  })();
  const aurora = new THREE.Mesh(
    new THREE.CylinderGeometry(60, 60, 22, 64, 1, true),
    new THREE.MeshBasicMaterial({
      map: auroraTex,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  aurora.position.y = 18;
  root.add(aurora);
  // snowfall
  const FLAKES = 1400;
  const flakePos = new Float32Array(FLAKES * 3);
  for (let i = 0; i < FLAKES; i++) {
    flakePos[i * 3] = rnd(-11, 11);
    flakePos[i * 3 + 1] = rnd(-0.5, 10);
    flakePos[i * 3 + 2] = rnd(-11, 11);
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
  {
    const [c, x] = canvas2d(32, 32);
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    root.add(
      new THREE.Points(
        snowGeo,
        new THREE.PointsMaterial({
          size: 0.09,
          map: new THREE.CanvasTexture(c),
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
  }

  return (dt, time) => {
    wheel.rotation.z += dt * 0.35;
    for (const cab of cabins) cab.rotation.z = -wheel.rotation.z;
    carousel.rotation.y += dt * 1.1;
    const ph = (time * 0.35) % 1;
    dropRing.position.y =
      ph < 0.7 ? 0.35 + (ph / 0.7) * 1.55 : 1.9 - ((ph - 0.7) / 0.3) ** 2 * 1.55;
    kakLight.visible = Math.sin(time * 3) > 0;
    for (const f of ferries) {
      f.t += ((dt * f.s) / (f.b - f.a)) * 2;
      const u = f.t % 2;
      const k = u < 1 ? u : 2 - u;
      const e = k * k * (3 - 2 * k);
      f.g.position.set(f.a + (f.b - f.a) * e, 0.02, f.z);
      f.g.rotation.y = u < 1 ? 0 : Math.PI;
    }
    auroraTex.offset.x += dt * 0.006;
    aurora.rotation.y += dt * 0.01;
    for (let i = 0; i < FLAKES; i++) {
      const y = i * 3 + 1;
      flakePos[y] = (flakePos[y] ?? 0) - dt * (0.35 + (i % 7) * 0.05);
      flakePos[i * 3] = (flakePos[i * 3] ?? 0) + Math.sin(time + i) * dt * 0.08;
      if ((flakePos[y] ?? 0) < -0.5) flakePos[y] = 10;
    }
    snowGeo.attributes.position!.needsUpdate = true;
  };
}

/** The Vasa ship, used in the city channel and (scaled down) as a player token. */
export function buildVasa(b: Builder, v: THREE.Group): THREE.Group {
  const s = new THREE.Shape();
  s.moveTo(-0.55, 0.36);
  s.lineTo(-0.48, 0.08);
  s.quadraticCurveTo(-0.3, -0.06, 0.2, -0.04);
  s.quadraticCurveTo(0.48, 0, 0.62, 0.2);
  s.lineTo(0.42, 0.2);
  s.lineTo(0.3, 0.16);
  s.lineTo(-0.3, 0.16);
  s.lineTo(-0.4, 0.3);
  s.lineTo(-0.55, 0.36);
  const hull = new THREE.ExtrudeGeometry(s, {
    depth: 0.22,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelThickness: 0.03,
    bevelSegments: 2,
  });
  hull.translate(0, 0, -0.11);
  b.mesh(hull, T(0x6b3a1f), 0, 0, 0, { parent: v });
  b.mesh(B(0.06, 0.22, 0.26), T(0xffc94d, GLOW(0xffa000, 0.4)), -0.55, 0.25, 0, { parent: v });
  b.mesh(B(0.9, 0.015, 0.012), T(0xffc94d), -0.02, 0.1, 0.135, { parent: v });
  b.mesh(B(0.9, 0.015, 0.012), T(0xffc94d), -0.02, 0.1, -0.135, { parent: v });
  for (const [x, h] of [
    [-0.25, 0.95],
    [0.05, 1.1],
    [0.33, 0.85],
  ] as const) {
    b.mesh(CYL(0.014, 0.018, h, 6), T(0x4a2a14), x, 0.16 + h / 2, 0, { parent: v });
    for (const k of [0.35, 0.62, 0.85]) {
      if (k * h < h - 0.05)
        b.mesh(B(0.012, 0.012, 0.36 - k * 0.15), T(0x4a2a14), x, 0.16 + k * h, 0, { parent: v });
    }
    b.mesh(B(0.06, 0.04, 0.004), T(0xff4747), x, 0.16 + h + 0.02, 0, { parent: v });
  }
  const rig = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.55, 0.36, 0),
    new THREE.Vector3(-0.25, 1.11, 0),
    new THREE.Vector3(0.05, 1.26, 0),
    new THREE.Vector3(0.33, 1.01, 0),
    new THREE.Vector3(0.62, 0.2, 0),
  ]);
  v.add(new THREE.Line(rig, new THREE.LineBasicMaterial({ color: 0x2a1a0a })));
  for (const x of [-0.5, 0.55]) b.bulb(x, 0.42, 0, 1, 0.03, v);
  return v;
}
