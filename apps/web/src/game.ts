/** The in-game screen: board, turn controls, players, trades and the event log. */
import { ITEM_NAMES, isOwnable, mortgageValue, spaceAt, unmortgageCost } from '@hometown/engine';
import type { GameEvent, ItemKind, PublicState, TradeSide } from '@hometown/engine';
import type { Intent, LobbyPlayer, Token } from '@hometown/protocol';
import { renderBoard } from './board.js';
import { h, kr } from './dom.js';
import { describeEvent, nameOf } from './format.js';
import { TOKEN_INFO } from './theme.js';

export interface GameView {
  state: PublicState;
  players: LobbyPlayer[];
  me: string;
  log: string[];
  clockOffset: number;
  selected: number | null;
  trading: boolean;
}

export interface GameHandlers {
  send: (intent: Intent) => void;
  select: (space: number | null) => void;
  toggleTrade: (open: boolean) => void;
  propose: (to: string, give: TradeSide, get: TradeSide) => void;
}

const btn = (label: string, onclick: () => void, kind = '') =>
  h('button', { class: `btn ${kind}`, onclick }, label);

export function appendLog(view: GameView, events: GameEvent[]): void {
  for (const e of events) {
    const line = describeEvent(view.state, e);
    if (line) view.log.unshift(line);
  }
  view.log.length = Math.min(view.log.length, 60);
}

function secondsLeft(view: GameView, deadline: number): number {
  return Math.max(0, Math.ceil((deadline - (Date.now() + view.clockOffset)) / 1000));
}

function controls(view: GameView, on: GameHandlers): HTMLElement {
  const { state, me } = view;
  const ph = state.phase;
  const meP = state.players.find((p) => p.id === me);
  const myTurn = state.turn.current === me;
  const turnName = nameOf(state, state.turn.current);
  const parts: (HTMLElement | string)[] = [];
  const send = on.send;

  if (meP?.pendingItem) {
    parts.push(
      h('p', {}, `You have one item too many. Pick one to throw away:`),
      h(
        'div',
        { class: 'row' },
        [...meP.items, meP.pendingItem].map((item) =>
          btn(ITEM_NAMES[item], () => send({ type: 'DISCARD_ITEM', item })),
        ),
      ),
    );
    return h('div', { class: 'controls' }, parts);
  }

  switch (ph.kind) {
    case 'gameOver':
      parts.push(h('h2', {}, `${ph.winners.map((id) => nameOf(state, id)).join(' & ')} won!`));
      if (ph.reason === 'backstop') parts.push(h('p', {}, 'Time ran out; the richest player won.'));
      break;
    case 'auction': {
      const next = Math.max(10, ph.highBid + 10);
      parts.push(
        h('h3', {}, `Auction: ${spaceAt(ph.space).name}`),
        h(
          'p',
          {},
          ph.highBidder
            ? `High bid ${kr(ph.highBid)} by ${nameOf(state, ph.highBidder)}`
            : 'No bids yet',
          ` · ${secondsLeft(view, ph.endsAt)} s`,
        ),
      );
      if (meP && !meP.bankrupt) {
        parts.push(
          h(
            'div',
            { class: 'row' },
            [next, next + 40, next + 90].map((amount) =>
              amount <= meP.cash
                ? btn(`Bid ${kr(amount)}`, () => send({ type: 'BID', amount }))
                : null,
            ),
          ),
        );
      }
      break;
    }
    case 'minigame':
      parts.push(h('h3', {}, 'Minigame in progress…'));
      break;
    case 'crisis': {
      const debtor = nameOf(state, ph.debtor);
      parts.push(
        h('h3', {}, `${ph.debtor === me ? 'You owe' : `${debtor} owes`} ${kr(ph.amount)}`),
        h(
          'p',
          {},
          `${secondsLeft(view, ph.endsAt)} s to raise money: tap your properties to sell or mortgage.`,
        ),
      );
      if (ph.debtor === me) {
        parts.push(btn('Give up (bankrupt)', () => send({ type: 'DECLARE_BANKRUPTCY' }), 'danger'));
      }
      break;
    }
    default: {
      parts.push(
        h(
          'p',
          { class: 'turn' },
          myTurn ? 'Your turn' : `${turnName}'s turn`,
          ` · ${secondsLeft(view, state.turn.deadline)} s`,
        ),
      );
      if (!myTurn || !meP) break;
      if (ph.kind === 'awaitingRoll') {
        const row = [btn('Roll dice', () => send({ type: 'ROLL' }), 'primary')];
        if (meP.inJail) {
          row.push(
            btn(`Pay ${kr(state.config.jailFine)} fine`, () => send({ type: 'PAY_JAIL_FINE' })),
          );
          if (meP.items.includes('advokat')) {
            row.push(btn('Use Advokat', () => send({ type: 'USE_ITEM', item: 'advokat' })));
          }
        } else {
          if (meP.items.includes('dubbeltarning')) {
            row.push(
              btn('Roll 3 (Dubbeltärning)', () => send({ type: 'ROLL', useItem: 'dubbeltarning' })),
            );
          }
          if (meP.items.includes('slkort')) {
            row.push(btn('Use SL-kort', () => send({ type: 'USE_ITEM', item: 'slkort' })));
          }
        }
        parts.push(h('div', { class: 'row' }, row));
      } else if (ph.kind === 'chooseDice') {
        const pairs: [number, number][] = [
          [0, 1],
          [0, 2],
          [1, 2],
        ];
        parts.push(
          h('p', {}, `You rolled ${ph.dice.join(', ')}. Keep two:`),
          h(
            'div',
            { class: 'row' },
            pairs.map((keep) =>
              btn(`${ph.dice[keep[0]]} + ${ph.dice[keep[1]]}`, () =>
                send({ type: 'CHOOSE_DICE', keep }),
              ),
            ),
          ),
        );
      } else if (ph.kind === 'adjustMove') {
        const total = ph.dice[0] + ph.dice[1];
        parts.push(
          h('p', {}, `You rolled ${total}. Use Snöplog to move fewer?`),
          h(
            'div',
            { class: 'row' },
            [0, 1, 2, 3].map((r) =>
              btn(r ? `Move ${total - r}` : `Move ${total}`, () =>
                send({ type: 'ADJUST_MOVE', reduceBy: r }),
              ),
            ),
          ),
        );
      } else if (ph.kind === 'awaitingBuyDecision') {
        const space = spaceAt(ph.space);
        const price = isOwnable(space) ? space.price : 0;
        parts.push(
          h('p', {}, `${space.name} is for sale.`),
          h(
            'div',
            { class: 'row' },
            meP.cash >= price
              ? btn(`Buy for ${kr(price)}`, () => send({ type: 'BUY' }), 'primary')
              : null,
            btn('Auction it', () => send({ type: 'DECLINE_BUY' })),
          ),
        );
      } else if (ph.kind === 'rentChoice') {
        parts.push(
          h('p', {}, `Rent due: ${kr(ph.amount)} to ${nameOf(state, ph.owner)}.`),
          h(
            'div',
            { class: 'row' },
            btn('Pay rent', () => send({ type: 'PAY_RENT' }), 'primary'),
            btn('Use Hyresfrihet', () => send({ type: 'USE_ITEM', item: 'hyresfrihet' })),
          ),
        );
      } else if (ph.kind === 'ohopp') {
        parts.push(
          h(
            'p',
            {},
            `Ö-HOPP! Pay ${kr(state.config.ohoppFee)} and tap any property on the board, or stay.`,
          ),
          btn('Stay', () => send({ type: 'STAY' })),
        );
      } else if (ph.kind === 'turnEnd') {
        parts.push(
          h(
            'div',
            { class: 'row' },
            btn('End turn', () => send({ type: 'END_TURN' }), 'primary'),
            btn('Trade', () => on.toggleTrade(true)),
          ),
        );
      }
    }
  }
  return h('div', { class: 'controls' }, parts);
}

function propertyPopover(view: GameView, on: GameHandlers): HTMLElement | null {
  const { state, me, selected } = view;
  if (selected === null) return null;
  const space = spaceAt(selected);
  const prop = state.properties[selected];
  const send = on.send;
  const rows: (HTMLElement | null)[] = [h('h3', {}, space.name)];
  if (space.kind === 'street') {
    rows.push(
      h(
        'p',
        { class: 'small' },
        `Rent ${space.rent.map((r) => kr(r)).join(' / ')} · house ${kr(space.houseCost)}`,
      ),
    );
  }
  if (prop) {
    rows.push(h('p', {}, prop.owner ? `Owner: ${nameOf(state, prop.owner)}` : 'Unowned'));
    if (prop.owner === me) {
      rows.push(
        h(
          'div',
          { class: 'row' },
          space.kind === 'street'
            ? btn('Build', () => send({ type: 'BUILD', space: selected }))
            : null,
          space.kind === 'street' && (prop.houses || prop.landmark)
            ? btn('Sell building', () => send({ type: 'SELL_BUILDING', space: selected }))
            : null,
          prop.mortgaged
            ? btn(`Lift mortgage (${kr(unmortgageCost(selected))})`, () =>
                send({ type: 'UNMORTGAGE', space: selected }),
              )
            : btn(`Mortgage (+${kr(mortgageValue(selected))})`, () =>
                send({ type: 'MORTGAGE', space: selected }),
              ),
        ),
      );
    }
  }
  if (state.phase.kind === 'ohopp' && state.turn.current === me && isOwnable(space)) {
    rows.push(
      btn(
        `Hop here (${kr(state.config.ohoppFee)})`,
        () => send({ type: 'HOP', to: selected }),
        'primary',
      ),
    );
  }
  rows.push(btn('Close', () => on.select(null)));
  return h('div', { class: 'popover' }, rows);
}

function playersList(view: GameView): HTMLElement {
  const { state } = view;
  return h(
    'ul',
    { class: 'players' },
    state.players.map((p) => {
      const lobby = view.players.find((l) => l.id === p.id);
      const info = TOKEN_INFO[p.token as Token];
      return h(
        'li',
        { class: `${p.id === state.turn.current ? 'active' : ''} ${p.bankrupt ? 'out' : ''}` },
        h(
          'span',
          { class: 'token', style: `background:${info?.color ?? '#fff'}` },
          info?.glyph ?? '●',
        ),
        h(
          'span',
          { class: 'pname' },
          p.name,
          p.id === view.me ? ' (you)' : '',
          lobby?.connected ? '' : ' · away',
        ),
        h('span', { class: 'cash' }, p.bankrupt ? 'bankrupt' : kr(p.cash)),
        p.items.length
          ? h('span', { class: 'items' }, p.items.map((i) => ITEM_NAMES[i]).join(', '))
          : null,
        p.inJail ? h('span', { class: 'items' }, 'In Arresten') : null,
      );
    }),
  );
}

function offers(view: GameView, on: GameHandlers): HTMLElement | null {
  const mine = view.state.trades.filter((t) => t.to === view.me);
  if (!mine.length) return null;
  const describe = (side: TradeSide) =>
    [
      side.cash ? kr(side.cash) : null,
      ...side.spaces.map((i) => spaceAt(i).name),
      ...side.items.map((i) => ITEM_NAMES[i]),
    ]
      .filter(Boolean)
      .join(', ');
  return h(
    'div',
    { class: 'offers' },
    mine.map((t) =>
      h(
        'div',
        { class: 'offer' },
        h(
          'p',
          {},
          `${nameOf(view.state, t.from)} offers ${describe(t.give)} for ${describe(t.get)}`,
        ),
        h(
          'div',
          { class: 'row' },
          btn(
            'Accept',
            () => on.send({ type: 'RESPOND_TRADE', tradeId: t.id, response: 'accept' }),
            'primary',
          ),
          btn('Decline', () =>
            on.send({ type: 'RESPOND_TRADE', tradeId: t.id, response: 'decline' }),
          ),
        ),
      ),
    ),
  );
}

function tradeForm(view: GameView, on: GameHandlers): HTMLElement | null {
  if (!view.trading) return null;
  const { state, me } = view;
  const others = state.players.filter((p) => p.id !== me && !p.bankrupt);
  const meP = state.players.find((p) => p.id === me);
  if (!meP || !others.length) return null;
  const owned = (id: string) =>
    Object.entries(state.properties)
      .filter(([, prop]) => prop.owner === id)
      .map(([i]) => Number(i));
  const partner = h(
    'select',
    { id: 'trade-to' },
    others.map((p) => h('option', { value: p.id }, p.name)),
  );
  const side = (label: string, prefix: string, spaces: number[], items: ItemKind[]) =>
    h(
      'fieldset',
      {},
      h('legend', {}, label),
      h(
        'label',
        {},
        'Cash ',
        h('input', { id: `${prefix}-cash`, type: 'number', min: 0, step: 10, value: 0 }),
      ),
      spaces.map((i) =>
        h(
          'label',
          {},
          h('input', { type: 'checkbox', class: `${prefix}-space`, value: i }),
          ` ${spaceAt(i).name}`,
        ),
      ),
      items.map((item, k) =>
        h(
          'label',
          {},
          h('input', { type: 'checkbox', class: `${prefix}-item`, value: item, 'data-k': k }),
          ` ${ITEM_NAMES[item]}`,
        ),
      ),
    );
  const theirs = h('div', { id: 'theirs' });
  const fillTheirs = () => {
    const id = (partner as HTMLSelectElement).value;
    const p = state.players.find((x) => x.id === id);
    theirs.replaceChildren(side(`You get from ${p?.name ?? ''}`, 'get', owned(id), p?.items ?? []));
  };
  partner.addEventListener('change', fillTheirs);
  fillTheirs();
  const read = (prefix: string): TradeSide => {
    const root = document.querySelector('.trade') as HTMLElement;
    const cash = Number((root.querySelector(`#${prefix}-cash`) as HTMLInputElement).value) || 0;
    const spaces = [...root.querySelectorAll<HTMLInputElement>(`.${prefix}-space:checked`)].map(
      (x) => Number(x.value),
    );
    const items = [...root.querySelectorAll<HTMLInputElement>(`.${prefix}-item:checked`)].map(
      (x) => x.value as ItemKind,
    );
    return { cash, spaces, items };
  };
  return h(
    'div',
    { class: 'trade' },
    h('h3', {}, 'Propose a trade'),
    h('label', {}, 'With ', partner),
    h('div', { class: 'sides' }, side('You give', 'give', owned(me), meP.items), theirs),
    h(
      'div',
      { class: 'row' },
      btn(
        'Send offer',
        () => on.propose((partner as HTMLSelectElement).value, read('give'), read('get')),
        'primary',
      ),
      btn('Cancel', () => on.toggleTrade(false)),
    ),
  );
}

export function renderGame(view: GameView, on: GameHandlers): HTMLElement {
  const { state } = view;
  const dice = state.turn.lastDice;
  const center = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'title' },
      h('h1', {}, 'Hometown'),
      h('span', { class: 'round' }, `Round ${state.round}`),
    ),
    dice
      ? h(
          'div',
          { class: 'dice' },
          dice.map((d) => h('span', { class: 'die' }, d)),
        )
      : null,
    controls(view, on),
    offers(view, on),
    tradeForm(view, on),
    propertyPopover(view, on),
    h(
      'ol',
      { class: 'log' },
      view.log.slice(0, 8).map((l) => h('li', {}, l)),
    ),
  );
  return h(
    'div',
    { class: 'game' },
    renderBoard(state, center, (i) => on.select(i)),
    h('aside', { class: 'side' }, h('h2', {}, 'Players'), playersList(view)),
  );
}
