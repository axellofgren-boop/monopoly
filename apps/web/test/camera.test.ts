import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

describe('CameraRig', () => {
  it('can leave fly mode, by toggling or by picking a view', async () => {
    vi.stubGlobal('addEventListener', () => undefined);
    vi.stubGlobal('removeEventListener', () => undefined);
    const { CameraRig } = await import('../src/scene/camera.js');
    const rig = new CameraRig(new THREE.PerspectiveCamera(40, 1.5, 0.1, 100));
    rig.update(0.016, false);
    rig.setMode('fly');
    expect(rig.mode).toBe('fly');
    rig.setMode('orbit');
    expect(rig.mode).toBe('orbit');
    rig.setMode('fly');
    rig.view('board');
    expect(rig.mode).toBe('orbit');
    vi.unstubAllGlobals();
  });
});
