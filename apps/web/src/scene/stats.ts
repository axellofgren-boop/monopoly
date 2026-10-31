/**
 * Frame-rate meter with adaptive resolution: when the frame rate drops, the canvas renders
 * at a lower pixel ratio (fewer pixels to shade); when there is headroom it climbs back.
 */
import type * as THREE from 'three';

export interface FrameStatsReport {
  fps: number;
  /** Current render scale relative to CSS pixels. */
  pixelRatio: number;
  drawCalls: number;
}

const WINDOW_MS = 500;
const LOW_FPS = 45;
const HIGH_FPS = 57;
const STEP = 0.25;
/** Never below 1x unless the frame rate is really poor; under 1x the board gets soft. */
const MIN_RATIO = 1;
const MIN_RATIO_STRUGGLING = 0.75;
const STRUGGLING_FPS = 30;

export class FrameStats {
  private frames = 0;
  private windowStart = performance.now();
  private calm = 0;
  private cooldown = 0;
  private readonly maxRatio: number;
  private ratio: number;
  onReport: (r: FrameStatsReport) => void = () => undefined;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly onRatioChange: () => void,
  ) {
    this.maxRatio = Math.min(devicePixelRatio || 1, 2);
    this.ratio = this.maxRatio;
    renderer.setPixelRatio(this.ratio);
  }

  /** Call once per rendered frame. */
  frame(now: number): void {
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < WINDOW_MS) return;
    const fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.windowStart = now;
    this.adapt(fps);
    this.onReport({
      fps: Math.round(fps),
      pixelRatio: this.ratio,
      drawCalls: this.renderer.info.render.calls,
    });
  }

  private adapt(fps: number): void {
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    const floor = Math.min(this.maxRatio, fps < STRUGGLING_FPS ? MIN_RATIO_STRUGGLING : MIN_RATIO);
    if (fps < LOW_FPS && this.ratio > floor) {
      this.setRatio(Math.max(floor, this.ratio - STEP));
      this.calm = 0;
    } else if (fps > HIGH_FPS && this.ratio < this.maxRatio) {
      // Only climb after a few calm seconds, so it doesn't flip back and forth.
      if (++this.calm >= 8) {
        this.setRatio(Math.min(this.maxRatio, this.ratio + STEP));
        this.calm = 0;
      }
    } else {
      this.calm = 0;
    }
  }

  private setRatio(r: number): void {
    this.ratio = r;
    this.renderer.setPixelRatio(r);
    this.onRatioChange();
    this.cooldown = 2; // let the new size settle before measuring again
  }
}
