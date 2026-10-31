/** App shell: lobby (create/join by link) and the game screen. */
import { TOKENS } from '@hometown/protocol';
import type { LobbyPlayer, ServerMessage, Token } from '@hometown/protocol';
import { h } from './dom.js';
import { appendLog, renderGame } from './game.js';
import type { GameView } from './game.js';
import { playPlogbilen } from './minigame.js';
import { Connection, saveSession } from './net.js';
import { TOKEN_INFO } from './theme.js';
import './style.css';

const app = document.getElementById('app') as HTMLElement;

interface Model {
  connected: boolean;
  error: string | null;
  code: string | null;
  me: string | null;
  lobby: LobbyPlayer[];
  game: GameView | null;
  playingMinigame: boolean;
}

const model: Model = {
  connected: false,
  error: null,
  code: new URLSearchParams(location.search).get('room')?.toUpperCase() ?? null,
  me: null,
  lobby: [],
  game: null,
  playingMinigame: false,
};

const conn = new Connection(onMessage, (connected) => {
  model.connected = connected;
  render();
});

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
      model.code = msg.code;
      model.me = msg.playerId;
      model.error = null;
      saveSession({ code: msg.code, playerId: msg.playerId, secret: msg.secret });
      history.replaceState(null, '', `?room=${msg.code}`);
      break;
    case 'lobby':
      model.lobby = msg.players;
      break;
    case 'state': {
      const me = model.me ?? '';
      const view: GameView = model.game ?? {
        state: msg.state,
        players: msg.players,
        me,
        log: [],
        clockOffset: 0,
        selected: null,
        trading: false,
      };
      view.state = msg.state;
      view.players = msg.players;
      view.me = me;
      view.clockOffset = msg.serverNow - Date.now();
      appendLog(view, msg.events);
      model.game = view;
      maybeStartMinigame();
      break;
    }
    case 'error':
      model.error = msg.message;
      if (/rejoin|ended/.test(msg.message)) saveSession(null);
      break;
  }
  render();
}

function maybeStartMinigame(): void {
  const view = model.game;
  if (!view || model.playingMinigame) return;
  const ph = view.state.phase;
  if (ph.kind !== 'minigame' || !ph.players.includes(view.me)) return;
  model.playingMinigame = true;
  playPlogbilen(document.body, (score) => {
    model.playingMinigame = false;
    conn.send({ type: 'minigameScore', score });
  });
}

// --------------------------------------------------------------------------- views

function lobbyView(): HTMLElement {
  const taken = new Set(model.lobby.map((p) => p.token));
  const firstFree = TOKENS.find((t) => !taken.has(t)) ?? TOKENS[0];
  const nameInput = h('input', {
    id: 'name',
    maxlength: 16,
    placeholder: 'Your name',
    autocomplete: 'nickname',
  });
  const tokenSelect = h(
    'select',
    { id: 'token' },
    TOKENS.map((t) =>
      h(
        'option',
        { value: t, disabled: taken.has(t), selected: t === firstFree },
        `${TOKEN_INFO[t].glyph} ${TOKEN_INFO[t].label}`,
      ),
    ),
  );
  const form = (label: string, onSubmit: (name: string, token: Token) => void) =>
    h(
      'form',
      {
        class: 'join',
        onsubmit: (e: Event) => {
          e.preventDefault();
          onSubmit(
            (nameInput as HTMLInputElement).value,
            (tokenSelect as HTMLSelectElement).value as Token,
          );
        },
      },
      nameInput,
      tokenSelect,
      h('button', { class: 'btn primary', type: 'submit' }, label),
    );

  if (!model.me) {
    return h(
      'main',
      { class: 'lobby' },
      h('h1', {}, 'Hometown'),
      h('p', {}, 'A Stockholm property party game. Play with 2 to 6 friends.'),
      model.code
        ? form(`Join game ${model.code}`, (name, token) =>
            conn.send({ type: 'join', code: model.code ?? '', name, token }),
          )
        : form('Create a game', (name, token) => conn.send({ type: 'create', name, token })),
      model.error ? h('p', { class: 'error' }, model.error) : null,
    );
  }

  const link = `${location.origin}/?room=${model.code}`;
  const host = model.lobby.find((p) => p.host)?.id === model.me;
  return h(
    'main',
    { class: 'lobby' },
    h('h1', {}, 'Hometown'),
    h('p', {}, 'Send this link to your friends:'),
    h(
      'div',
      { class: 'row' },
      h('code', { class: 'link' }, link),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => navigator.clipboard?.writeText(link).catch(() => undefined),
        },
        'Copy',
      ),
    ),
    h(
      'ul',
      { class: 'players' },
      model.lobby.map((p) =>
        h(
          'li',
          {},
          h(
            'span',
            { class: 'token', style: `background:${TOKEN_INFO[p.token].color}` },
            TOKEN_INFO[p.token].glyph,
          ),
          ` ${p.name}`,
          p.host ? ' (host)' : '',
        ),
      ),
    ),
    host
      ? h(
          'button',
          {
            class: 'btn primary',
            disabled: model.lobby.length < 2,
            onclick: () => conn.send({ type: 'start' }),
          },
          model.lobby.length < 2 ? 'Waiting for players…' : 'Start game',
        )
      : h('p', {}, 'Waiting for the host to start…'),
    model.error ? h('p', { class: 'error' }, model.error) : null,
  );
}

function render(): void {
  const view = model.game;
  const screen = view
    ? renderGame(view, {
        send: (intent) => conn.send({ type: 'intent', intent }),
        select: (space) => {
          view.selected = space;
          render();
        },
        toggleTrade: (open) => {
          view.trading = open;
          render();
        },
        propose: (to, give, get) => {
          conn.send({ type: 'intent', intent: { type: 'PROPOSE_TRADE', to, give, get } });
          view.trading = false;
          render();
        },
      })
    : lobbyView();
  const banner = model.connected ? null : h('div', { class: 'banner' }, 'Reconnecting…');
  const toast = view && model.error ? h('div', { class: 'toast' }, model.error) : null;
  app.replaceChildren(...[banner, screen, toast].filter((x): x is HTMLElement => x !== null));
  if (toast) setTimeout(() => (model.error = null), 3000);
}

// Keep the countdowns fresh without a server message.
setInterval(() => {
  if (model.game && !model.game.trading) render();
}, 1000);

render();
