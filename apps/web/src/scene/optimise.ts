/**
 * Turns the hand-built static scene into a few large draw calls:
 * every static mesh is baked into world space and merged per material, and every static
 * glow sprite becomes a point in one Points cloud per halo colour and size.
 * The look is unchanged; the GPU goes from ~1500 draw calls per pass to ~150.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface HaloCloud {
  material: THREE.PointsMaterial;
  /** World size of each glow, to rescale when the camera's field of view changes. */
  worldSize: number;
}

export interface BakeResult {
  halos: HaloCloud[];
  /** Halo clouds that share a sprite material, so their opacity can follow it. */
  linked: Map<THREE.SpriteMaterial, THREE.PointsMaterial[]>;
}

/** Splits a multi-material geometry into one geometry per material group. */
function splitGroups(geo: THREE.BufferGeometry): { geo: THREE.BufferGeometry; index: number }[] {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (!geo.groups.length) return [{ geo: flat, index: 0 }];
  return geo.groups.map((g) => {
    const part = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(flat.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const size = a.itemSize;
      const start = g.start * size;
      const end = (g.start + g.count) * size;
      part.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start, end), size));
    }
    return { geo: part, index: g.materialIndex ?? 0 };
  });
}

/**
 * Bakes everything under `root` except the subtrees in `keep` (things that move).
 * Must run after the scene is built and before the first frame.
 */
export function bakeStatic(
  root: THREE.Object3D,
  keep: Set<THREE.Object3D>,
  fov: number,
): BakeResult {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  const sprites: THREE.Sprite[] = [];
  const visit = (o: THREE.Object3D) => {
    if (keep.has(o)) return;
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    else if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite);
    for (const child of o.children) visit(child);
  };
  visit(root);

  // Glow sprites -> one Points cloud per (material, size).
  const halos: HaloCloud[] = [];
  const linked = new Map<THREE.SpriteMaterial, THREE.PointsMaterial[]>();
  const spriteBuckets = new Map<
    string,
    { mat: THREE.SpriteMaterial; size: number; pts: number[] }
  >();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const s of sprites) {
    s.getWorldPosition(pos);
    s.getWorldScale(scale);
    const size = Math.round(scale.x * 1000) / 1000;
    const key = `${s.material.uuid}|${size}`;
    let bucket = spriteBuckets.get(key);
    if (!bucket) {
      bucket = { mat: s.material, size, pts: [] };
      spriteBuckets.set(key, bucket);
    }
    bucket.pts.push(pos.x, pos.y, pos.z);
    s.removeFromParent();
  }
  const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  for (const { mat, size, pts } of spriteBuckets.values()) {
    const material = new THREE.PointsMaterial({
      map: mat.map,
      color: mat.color,
      size: size / tan,
      sizeAttenuation: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: mat.opacity,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    root.add(new THREE.Points(geo, material));
    halos.push({ material, worldSize: size });
    linked.set(mat, [...(linked.get(mat) ?? []), material]);
  }

  // Meshes -> world-space geometry merged per material (and shadow casting).
  const buckets = new Map<
    string,
    { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }
  >();
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const { geo, index } of splitGroups(m.geometry)) {
      const mat = mats[index] ?? mats[0];
      if (!mat) continue;
      const g = (geo === m.geometry ? geo.clone() : geo).applyMatrix4(m.matrixWorld);
      if (g.index) g.copy(g.toNonIndexed());
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      if (!g.attributes.uv) {
        const count = g.attributes.position?.count ?? 0;
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      }
      const key = `${mat.uuid}|${m.castShadow}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { mat, cast: m.castShadow, geos: [] };
        buckets.set(key, bucket);
      }
      bucket.geos.push(g);
    }
  }
  for (const m of meshes) m.removeFromParent();
  for (const { mat, cast, geos } of buckets.values()) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const g of geos) g.dispose();
  }
  return { halos, linked };
}

/** Keeps halo glows the same on-screen size when the field of view changes. */
export function rescaleHalos(halos: HaloCloud[], fov: number): void {
  const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  for (const h of halos) h.material.size = h.worldSize / tan;
}
