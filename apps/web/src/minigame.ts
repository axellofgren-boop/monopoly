/**
 * Prototype minigame "Plogbilen": clear as much snow as you can in 10 seconds by tapping
 * (or pressing space). Real minigames come in Step 4; this proves the flow end to end.
 */
import { h } from './dom.js';

export const MINIGAME_MS = 10_000;

export function playPlogbilen(root: HTMLElement, onDone: (score: number) => void): void {
  let score = 0;
  let done = false;
  const counter = h('div', { class: 'mg-score' }, '0');
  const timer = h('div', { class: 'mg-timer' }, '10');
  const plow = h('button', { class: 'mg-plow', 'aria-label': 'Clear snow' }, '🚜❄️');
  const overlay = h(
    'div',
    { class: 'minigame' },
    h('h2', {}, 'Plogbilen!'),
    h('p', {}, 'Tap the plough (or press space) as fast as you can to clear the snow.'),
    plow,
    counter,
    timer,
  );
  const hit = () => {
    if (done) return;
    score += 1;
    counter.textContent = String(score);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      hit();
    }
  };
  plow.addEventListener('pointerdown', hit);
  window.addEventListener('keydown', onKey);
  root.append(overlay);
  const started = performance.now();
  const interval = window.setInterval(() => {
    const left = Math.max(0, MINIGAME_MS - (performance.now() - started));
    timer.textContent = String(Math.ceil(left / 1000));
    if (left > 0) return;
    done = true;
    window.clearInterval(interval);
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    onDone(score);
  }, 100);
}
