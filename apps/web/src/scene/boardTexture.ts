/**
 * The printed board, drawn on a canvas from the engine's BOARD data so the 3D board always
 * matches the rules. Layout and styling follow the approved look (round 3).
 */
import { BOARD, DEFAULT_CONFIG, TRANGSELSKATT } from '@hometown/engine';
import type { Space } from '@hometown/engine';
import { GROUP_COLORS } from '../theme.js';
import { CORNER, BOARD_HALF } from './layout.js';

const CORNER_STYLE: Record<number, { color: string; sub: string }> = {
  0: { color: '#ffd34d', sub: `+${DEFAULT_CONFIG.passStart} kr` },
  10: { color: '#ff8f6b', sub: '' },
  20: { color: '#7fe0c4', sub: 'Vila' },
  30: { color: '#c49bff', sub: 'Välj ö' },
};

const INK = '#16224a';
const font = (f: string) => `${f} "Instrument Sans","Segoe UI",sans-serif`;

function priceLabel(space: Space): string {
  switch (space.kind) {
    case 'street':
    case 'station':
    case 'utility':
      return `${space.price} kr`;
    case 'tax':
      return space.tax === 'flat' ? `Betala ${TRANGSELSKATT} kr` : 'Betala 10 %';
    default:
      return '';
  }
}

function drawIcon(x: CanvasRenderingContext2D, space: Space, cx: number, cy: number): void {
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const glyph = (color: string, size: number, text: string) => {
    x.fillStyle = color;
    x.font = font(`800 ${size}px`);
    x.fillText(text, cx, cy);
  };
  switch (space.kind) {
    case 'station':
      x.fillStyle = '#1b7fd1';
      x.beginPath();
      x.arc(cx, cy, 32, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#fff';
      x.font = font('800 42px');
      x.fillText('T', cx, cy + 2);
      break;
    case 'card':
      glyph('#ff5fa8', 64, '?');
      break;
    case 'minigame':
      glyph('#ffb800', 64, '★');
      break;
    case 'utility':
      glyph('#2fa8e8', 54, '⚡');
      break;
    case 'tax':
      glyph(INK, 44, '§');
      break;
    case 'inspector':
      x.fillStyle = '#e8344e';
      x.beginPath();
      x.arc(cx, cy, 32, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#fff';
      x.font = font('800 44px');
      x.fillText('!', cx, cy + 2);
      break;
    default:
      break;
  }
}

/** Splits a name into lines that fit the tile width. */
function wrap(x: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (x.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  lines.push(cur);
  return lines;
}

/** Draws the board onto a canvas (2048 logical px, rendered at 2x). */
export function drawBoard(canvas: HTMLCanvasElement): void {
  const N = 2048;
  const c = Math.round((N * CORNER) / (BOARD_HALF * 2));
  const w = (N - 2 * c) / 9;
  canvas.width = canvas.height = N * 2;
  const x = canvas.getContext('2d');
  if (!x) return;
  x.setTransform(2, 0, 0, 2, 0, 0);
  x.fillStyle = '#f7fbff';
  x.fillRect(0, 0, N, N);
  x.fillStyle = '#cfe0f2';
  x.fillRect(c, c, N - 2 * c, N - 2 * c);
  x.strokeStyle = '#1c2c55';
  x.lineWidth = 5;

  for (let side = 0; side < 4; side++) {
    x.save();
    x.translate(N / 2, N / 2);
    x.rotate((side * Math.PI) / 2);
    x.translate(-N / 2, -N / 2);

    const cornerIndex = side * 10;
    const cornerSpace = BOARD[cornerIndex];
    const style = CORNER_STYLE[cornerIndex];
    if (cornerSpace && style) {
      x.fillStyle = style.color;
      x.fillRect(N - c, N - c, c, c);
      x.strokeRect(N - c, N - c, c, c);
      x.save();
      x.translate(N - c / 2, N - c / 2);
      x.rotate(-Math.PI / 4);
      x.fillStyle = INK;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = font('800 44px');
      x.fillText(cornerSpace.name, 0, style.sub ? -16 : 0);
      if (style.sub) {
        x.font = font('600 26px');
        x.fillText(style.sub, 0, 26);
      }
      x.restore();
    }

    for (let k = 1; k <= 9; k++) {
      const space = BOARD[cornerIndex + k];
      if (!space) continue;
      const x0 = N - c - k * w;
      const y0 = N - c;
      x.strokeRect(x0, y0, w, c);
      let ty = y0 + 20;
      if (space.kind === 'street') {
        x.fillStyle = GROUP_COLORS[space.group];
        x.fillRect(x0 + 2, y0 + 2, w - 4, c * 0.24);
        x.strokeRect(x0, y0, w, c * 0.24);
        ty = y0 + c * 0.24 + 16;
      }
      x.fillStyle = INK;
      x.textAlign = 'center';
      x.textBaseline = 'top';
      let size = 23;
      x.font = font(`600 ${size}px`);
      const lines = wrap(x, space.name.toUpperCase(), w - 18);
      while (size > 14 && lines.some((l) => x.measureText(l).width > w - 12)) {
        size--;
        x.font = font(`600 ${size}px`);
      }
      lines.forEach((l, i) => x.fillText(l, x0 + w / 2, ty + i * (size + 4)));
      drawIcon(x, space, x0 + w / 2, y0 + c * 0.62);
      const price = priceLabel(space);
      if (price) {
        x.fillStyle = INK;
        x.textAlign = 'center';
        x.textBaseline = 'alphabetic';
        x.font = font('600 23px');
        x.fillText(price, x0 + w / 2, y0 + c - 16);
      }
    }
    x.restore();
  }
  x.lineWidth = 8;
  x.strokeRect(4, 4, N - 8, N - 8);
  x.strokeRect(c, c, N - 2 * c, N - 2 * c);
}
