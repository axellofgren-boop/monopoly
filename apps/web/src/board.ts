/**
 * The 2D prototype board: an 11 x 11 grid with the 40 spaces around the edge and a centre
 * area for the game panel. Step 3 replaces this with the 3D board; it reads the same state.
 */
import { BOARD, isOwnable } from '@hometown/engine';
import type { PublicState } from '@hometown/engine';
import type { Token } from '@hometown/protocol';
import { h, kr } from './dom.js';
import { GROUP_COLORS, TOKEN_INFO } from './theme.js';

/** Grid row/column (0-based) for a board index, START bottom-right, moving clockwise. */
export function cellFor(index: number): { row: number; col: number } {
  if (index <= 10) return { row: 10, col: 10 - index };
  if (index <= 20) return { row: 20 - index, col: 0 };
  if (index <= 30) return { row: 0, col: index - 20 };
  return { row: index - 30, col: 10 };
}

export function renderBoard(
  state: PublicState,
  center: HTMLElement,
  onSpace: (index: number) => void,
): HTMLElement {
  const seatColor = new Map(
    state.players.map((p) => [p.id, TOKEN_INFO[p.token as Token]?.color ?? '#fff']),
  );
  const cells = BOARD.map((space, index) => {
    const { row, col } = cellFor(index);
    const prop = state.properties[index];
    const tokens = state.players.filter((p) => !p.bankrupt && p.position === index);
    const corner = index % 10 === 0;
    const owner = prop?.owner ? seatColor.get(prop.owner) : undefined;
    return h(
      'button',
      {
        class: `cell${corner ? ' corner' : ''}${prop?.mortgaged ? ' mortgaged' : ''}`,
        style: `grid-row:${row + 1};grid-column:${col + 1};${owner ? `--owner:${owner}` : ''}`,
        title: space.name,
        onclick: () => onSpace(index),
      },
      space.kind === 'street'
        ? h('span', { class: 'band', style: `background:${GROUP_COLORS[space.group]}` })
        : null,
      h('span', { class: 'name' }, space.name),
      isOwnable(space) ? h('span', { class: 'price' }, kr(space.price)) : null,
      prop && (prop.houses || prop.landmark)
        ? h('span', { class: 'buildings' }, prop.landmark ? '🏛' : '⌂'.repeat(prop.houses))
        : null,
      owner ? h('span', { class: 'owner' }) : null,
      tokens.length
        ? h(
            'span',
            { class: 'tokens' },
            tokens.map((p) =>
              h(
                'span',
                {
                  class: 'token',
                  title: p.name,
                  style: `background:${TOKEN_INFO[p.token as Token]?.color ?? '#fff'}`,
                },
                TOKEN_INFO[p.token as Token]?.glyph ?? '●',
              ),
            ),
          )
        : null,
    );
  });
  return h('div', { class: 'board' }, cells, h('div', { class: 'center' }, center));
}
