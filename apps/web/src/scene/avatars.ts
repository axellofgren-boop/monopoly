/**
 * Other players as floating avatars: their token, larger, hovering where their camera is and
 * facing where they look, with a faint view cone and a name tag.
 */
import * as THREE from 'three';
import type { CameraPose, Token } from '@hometown/protocol';
import { TOKEN_INFO } from '../theme.js';
import { canvas2d, srgbTexture } from './builder.js';
import { shortestAngle } from './camera.js';
import type { Builder } from './builder.js';
import { buildToken } from './tokens.js';

const AVATAR_SCALE = 1.7;
/** How far in front of the camera the avatar floats, so it is seen just ahead of the view. */
const AHEAD = 0.25;

interface Avatar {
  group: THREE.Group;
  body: THREE.Group;
  pose: CameraPose | null;
  token: string;
}

function nameTag(name: string, color: string): THREE.Sprite {
  const [c, x] = canvas2d(256, 64);
  x.font = '600 30px "Instrument Sans","Segoe UI",sans-serif';
  const w = Math.min(248, x.measureText(name).width + 36);
  x.fillStyle = 'rgba(15,24,56,.85)';
  x.beginPath();
  x.roundRect((256 - w) / 2, 6, w, 52, 26);
  x.fill();
  x.strokeStyle = color;
  x.lineWidth = 4;
  x.stroke();
  x.fillStyle = '#ffffff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(name, 128, 33);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: srgbTexture(c), depthWrite: false, transparent: true }),
  );
  sprite.scale.set(1, 0.25, 1);
  return sprite;
}

export class Avatars {
  private readonly avatars = new Map<string, Avatar>();
  private readonly tmp = new THREE.Vector3();
  private readonly coneGeo = (() => {
    const g = new THREE.ConeGeometry(0.35, 1.1, 24, 1, true);
    g.rotateZ(Math.PI / 2); // apex towards -x
    g.translate(0.55, 0, 0); // apex at the avatar, opening forward (+x)
    return g;
  })();

  constructor(
    private readonly builder: Builder,
    private readonly parent: THREE.Object3D,
  ) {}

  /** Keeps one avatar per other player who is still in the game. */
  setPlayers(players: { id: string; name: string; token: string }[], me: string | null): void {
    const wanted = new Set(players.filter((p) => p.id !== me).map((p) => p.id));
    for (const [id, a] of this.avatars) {
      if (!wanted.has(id)) {
        this.parent.remove(a.group);
        this.avatars.delete(id);
      }
    }
    for (const p of players) {
      if (!wanted.has(p.id) || this.avatars.get(p.id)?.token === p.token) continue;
      const color = TOKEN_INFO[p.token as Token]?.color ?? '#ffffff';
      const group = new THREE.Group();
      const body = new THREE.Group();
      const model = buildToken(this.builder, p.token as Token);
      model.scale.setScalar(AVATAR_SCALE);
      model.position.y = -0.45;
      model.traverse((o) => (o.castShadow = false));
      body.add(model);
      const cone = new THREE.Mesh(
        this.coneGeo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      body.add(cone);
      group.add(body);
      const tag = nameTag(p.name, color);
      tag.position.y = 0.75;
      group.add(tag);
      group.visible = false;
      this.parent.add(group);
      this.avatars.set(p.id, { group, body, pose: null, token: p.token });
    }
  }

  setPoses(poses: Record<string, CameraPose>): void {
    for (const [id, a] of this.avatars) {
      const pose = poses[id];
      a.pose = pose ?? null;
      if (!pose) a.group.visible = false;
    }
  }

  update(dt: number, time: number): void {
    const ease = Math.min(1, dt * 5);
    for (const a of this.avatars.values()) {
      const pose = a.pose;
      if (!pose) continue;
      const fx = -Math.sin(pose.yaw) * Math.cos(pose.pitch);
      const fy = Math.sin(pose.pitch);
      const fz = -Math.cos(pose.yaw) * Math.cos(pose.pitch);
      const x = pose.p[0] + fx * AHEAD;
      const y = pose.p[1] + fy * AHEAD + Math.sin(time * 1.8 + x) * 0.05;
      const z = pose.p[2] + fz * AHEAD;
      if (!a.group.visible) {
        a.group.position.set(x, y, z);
        a.group.visible = true;
      } else {
        a.group.position.lerp(this.tmp.set(x, y, z), ease);
      }
      // The model faces +x; turn it to the look direction, then tilt by the pitch.
      const yaw = pose.yaw + Math.PI / 2;
      a.body.rotation.order = 'YZX';
      a.body.rotation.y += shortestAngle(a.body.rotation.y, yaw) * ease;
      a.body.rotation.z += (pose.pitch - a.body.rotation.z) * ease;
    }
  }
}
