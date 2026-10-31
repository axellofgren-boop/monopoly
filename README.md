# Hometown

A 3D online property-trading party game set in Stockholm, for 2 to 6 friends in the browser.
Roll the dice, buy streets from Liljeholmen to Djurgården, build houses and landmarks, play
minigames and be the last player standing.

The rules live in the [Hometown rulebook](https://claude.ai/artifact/ELMJdVKNULtnovWDR2EBRi).

## Project layout

| Path                | What it is                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine`   | The rules engine: a pure, deterministic reducer with no I/O. All game rules and their tests live here.                       |
| `packages/protocol` | Message types shared by the server and the browser.                                                                          |
| `apps/server`       | Node game server: rooms, join-by-link, timers, minigame scores, autopilot for players who drop out. Serves the built client. |
| `apps/web`          | Browser client (Vite + TypeScript + three.js). The 3D Stockholm board, with a 2D fallback when WebGL is unavailable.         |

The server is authoritative: browsers send intents ("roll", "buy"), the server stamps the
player and time, runs the engine and broadcasts the public state. Card order and the RNG seed
never leave the server.

## Getting started

Requires [Node.js](https://nodejs.org) 20 or newer and [Git](https://git-scm.com). Works on
Windows, macOS and Linux.

```sh
git clone https://github.com/axellofgren-boop/monopoly.git
cd monopoly
npm install
npm run play       # builds the game and serves it on http://localhost:8787
```

Open http://localhost:8787, create a game and open the invite link in a second browser window
to play both sides. Press Ctrl+C to stop.

For development with hot reload:

```sh
npm run dev        # server on :8787 and client on http://localhost:5173
```

## Checks

```sh
npm run check      # format, lint, typecheck and tests, the same as CI
npm test           # tests only
```

## Conventions

- TypeScript in strict mode everywhere; ESLint and Prettier enforce style.
- Game rules belong in `packages/engine` and come with tests. Rendering code never decides rules.
- Engine state is plain JSON, so it can be sent, stored and replayed.
- Time and randomness are inputs: actions carry `now`, dice come from the seeded RNG in state.
