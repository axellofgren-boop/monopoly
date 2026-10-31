import type { ColorGroup } from '@hometown/engine';
import type { Token } from '@hometown/protocol';

/** Colour-group colours, matching the approved look. */
export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: '#a8653f',
  lightBlue: '#4fc3ff',
  pink: '#ff5fa8',
  orange: '#ff9a2e',
  red: '#ff4747',
  yellow: '#ffd02e',
  green: '#36d68b',
  darkBlue: '#5b7bff',
};

export const TOKEN_INFO: Record<Token, { label: string; color: string; glyph: string }> = {
  dalahast: { label: 'Dala horse', color: '#d62828', glyph: '🐴' },
  kanelbulle: { label: 'Kanelbulle', color: '#c8853f', glyph: '🥐' },
  alg: { label: 'Moose', color: '#7a4a2a', glyph: '🫎' },
  vasaskepp: { label: 'Vasa ship', color: '#ffc94d', glyph: '⛵' },
  viking: { label: 'Viking', color: '#5b7bff', glyph: '🛡️' },
  fika: { label: 'Fika cup', color: '#36d68b', glyph: '☕' },
};
