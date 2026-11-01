import { describe, expect, it } from 'vitest';
import { applyAction, BOARD, CARDS, createGame } from '../src/index.js';
import { T0, act, edit, newGame, own, player, refused, roll } from './helpers.js';

const MIN = 60_000;

describe('setup', () => {
  it('gives everyone 2 500 kr on START and a shuffled 16-card deck', () => {
    const s = newGame(3);
    expect(s.players.map((p) => [p.id, p.cash, p.position])).toEqual([
      ['ann', 2500, 0],
      ['bo', 2500, 0],
      ['cy', 2500, 0],
    ]);
    expect([...s.deck].sort((a, b) => a - b)).toEqual(CARDS.map((_, i) => i));
    expect(s.phase.kind).toBe('awaitingRoll');
    expect(BOARD).toHaveLength(40);
  });

  it('rejects too few players and duplicate ids', () => {
    expect(() =>
      createGame({ players: [{ id: 'a', name: 'A', token: 't' }], seed: 1, now: 0 }),
    ).toThrow();
    expect(() =>
      createGame({
        players: [
          { id: 'a', name: 'A', token: 't' },
          { id: 'a', name: 'B', token: 't' },
        ],
        seed: 1,
        now: 0,
      }),
    ).toThrow();
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      let s = newGame(2);
      for (let i = 0; i < 6; i++) {
        const r = applyAction(s, { type: 'TICK', now: T0 + (i + 1) * 61_000 });
        if (r.ok) s = r.state;
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe('moving, buying and rent', () => {
  it('lets the player buy an unowned street and pass the turn', () => {
    let { state: s } = roll(newGame(), 1, 2); // Hammarby sjöstad (3)
    expect(s.phase).toEqual({ kind: 'awaitingBuyDecision', space: 3 });
    s = act(s, { type: 'BUY', player: 'ann' }).state;
    expect(player(s, 'ann').cash).toBe(2400);
    expect(s.properties[3]?.owner).toBe('ann');
    expect(s.phase.kind).toBe('turnEnd');
    s = act(s, { type: 'END_TURN', player: 'ann' }).state;
    expect(s.turn.current).toBe('bo');
  });

  it('refuses actions from the wrong player', () => {
    expect(refused(newGame(), { type: 'ROLL', player: 'bo', dice: [1, 2] })).toMatch(/not your/);
  });

  it('charges base rent, and double rent for a full unbuilt group', () => {
    let s = own(newGame(), 'bo', 3);
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').cash).toBe(2490);
    expect(player(s, 'bo').cash).toBe(2510);

    s = own(newGame(), 'bo', 1, 3);
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').cash).toBe(2480);
  });

  it('charges no rent on a mortgaged street', () => {
    let s = edit(own(newGame(), 'bo', 3), (d) => {
      d.properties[3]!.mortgaged = true;
    });
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').cash).toBe(2500);
  });

  it('charges station rent by the number of stations owned', () => {
    let s = own(newGame(), 'bo', 4, 17);
    s = roll(s, 1, 3).state;
    expect(player(s, 'ann').cash).toBe(2450);
  });

  it('charges utility rent as a multiple of the dice', () => {
    let s = edit(own(newGame(), 'bo', 13), (d) => {
      d.players[0]!.position = 9;
    });
    s = roll(s, 1, 3).state; // 4 * 5
    expect(player(s, 'ann').cash).toBe(2480);
  });

  it('pays 250 kr for passing START and 400 kr for landing on it', () => {
    let s = edit(newGame(), (d) => {
      d.players[0]!.position = 38;
    });
    s = roll(s, 1, 2).state; // to 1, passing START
    expect(player(s, 'ann').cash).toBe(2750);

    s = edit(newGame(), (d) => {
      d.players[0]!.position = 37;
    });
    s = roll(s, 1, 2).state; // exactly START
    expect(player(s, 'ann').cash).toBe(2900);
  });
});

describe('doubles and Arresten', () => {
  it('rolls again after a double, and goes to Arresten on the third', () => {
    let s = roll(newGame(), 1, 1).state; // 2: minigame space
    s = act(s, { type: 'MINIGAME_RESULT', scores: {} }).state;
    expect(s.phase.kind).toBe('awaitingRoll');
    s = roll(s, 2, 2).state; // 6: card
    if (s.phase.kind !== 'awaitingRoll') {
      s = edit(s, (d) => {
        d.phase = { kind: 'awaitingRoll' };
      });
    }
    s = roll(s, 3, 3).state;
    expect(player(s, 'ann').inJail).toBe(true);
    expect(player(s, 'ann').position).toBe(10);
    expect(s.phase.kind).toBe('turnEnd');
  });

  it('releases on a double, or after the third try for a 100 kr fine', () => {
    const jailed = edit(newGame(), (d) => {
      d.players[0]!.position = 10;
      d.players[0]!.inJail = true;
    });
    let s = roll(jailed, 2, 2).state;
    expect(player(s, 'ann').inJail).toBe(false);
    expect(player(s, 'ann').position).toBe(14);
    expect(s.phase.kind).not.toBe('awaitingRoll'); // no extra roll

    s = edit(jailed, (d) => {
      d.players[0]!.jailAttempts = 2;
    });
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').inJail).toBe(false);
    expect(player(s, 'ann').cash).toBe(2400);
    expect(player(s, 'ann').position).toBe(13);
  });

  it('lets a jailed player pay the fine before rolling', () => {
    const s = edit(newGame(), (d) => {
      d.players[0]!.position = 10;
      d.players[0]!.inJail = true;
    });
    const out = act(s, { type: 'PAY_JAIL_FINE', player: 'ann' }).state;
    expect(player(out, 'ann').inJail).toBe(false);
    expect(player(out, 'ann').cash).toBe(2400);
  });
});

describe('not buying', () => {
  it('leaves the place with the bank and carries on with the turn', () => {
    let s = roll(newGame(), 1, 2).state;
    const out = act(s, { type: 'DECLINE_BUY', player: 'ann' });
    s = out.state;
    expect(s.properties[3]?.owner).toBeNull();
    expect(player(s, 'ann').cash).toBe(2500);
    expect(s.phase.kind).toBe('turnEnd');
    expect(out.events).toContainEqual({ type: 'declinedBuy', player: 'ann', space: 3 });
  });

  it('declines automatically when the turn timer runs out', () => {
    let s = roll(newGame(), 1, 2).state;
    s = act(s, { type: 'TICK', now: T0 + 60_000 }).state;
    expect(s.properties[3]?.owner).toBeNull();
    expect(s.phase.kind).not.toBe('awaitingBuyDecision');
  });
});

describe('building', () => {
  const browns = () => own(newGame(), 'ann', 1, 3);

  it('needs the whole group and builds evenly', () => {
    expect(refused(own(newGame(), 'ann', 1), { type: 'BUILD', player: 'ann', space: 1 })).toMatch(
      /whole colour group/,
    );
    let s = act(browns(), { type: 'BUILD', player: 'ann', space: 1 }).state;
    expect(refused(s, { type: 'BUILD', player: 'ann', space: 1 })).toMatch(/evenly/);
    s = act(s, { type: 'BUILD', player: 'ann', space: 3 }).state;
    expect(player(s, 'ann').cash).toBe(2350);
    expect(s.bank.houses).toBe(28);
  });

  it('upgrades three houses to a landmark and returns the houses', () => {
    let s = browns();
    for (let i = 0; i < 3; i++) {
      s = act(s, { type: 'BUILD', player: 'ann', space: 1 }).state;
      s = act(s, { type: 'BUILD', player: 'ann', space: 3 }).state;
    }
    expect(s.bank.houses).toBe(24);
    s = act(s, { type: 'BUILD', player: 'ann', space: 1 }).state;
    expect(s.properties[1]).toMatchObject({ houses: 0, landmark: true });
    expect(s.bank).toEqual({ houses: 27, landmarks: 9 });
    expect(player(s, 'ann').cash).toBe(2500 - 6 * 75 - 150);
  });

  it('stops building when the bank runs out of houses', () => {
    const s = edit(browns(), (d) => {
      d.bank.houses = 0;
    });
    expect(refused(s, { type: 'BUILD', player: 'ann', space: 1 })).toMatch(/no houses/);
  });

  it('sells buildings back at half price, evenly', () => {
    let s = browns();
    s = act(s, { type: 'BUILD', player: 'ann', space: 1 }).state;
    s = act(s, { type: 'BUILD', player: 'ann', space: 3 }).state;
    s = act(s, { type: 'BUILD', player: 'ann', space: 1 }).state;
    expect(refused(s, { type: 'SELL_BUILDING', player: 'ann', space: 3 })).toMatch(/evenly/);
    s = act(s, { type: 'SELL_BUILDING', player: 'ann', space: 1 }).state;
    expect(player(s, 'ann').cash).toBe(2500 - 3 * 75 + 37);
  });

  it('applies Byggrabatt to the next house', () => {
    const s = edit(browns(), (d) => {
      d.players[0]!.items = ['byggrabatt'];
    });
    const out = act(s, { type: 'BUILD', player: 'ann', space: 1 }).state;
    expect(player(out, 'ann').cash).toBe(2462);
    expect(player(out, 'ann').items).toEqual([]);
  });
});

describe('mortgages, debt and bankruptcy', () => {
  it('mortgages for half the price and lifts for that plus 10%', () => {
    let s = own(newGame(), 'ann', 39);
    s = act(s, { type: 'MORTGAGE', player: 'ann', space: 39 }).state;
    expect(player(s, 'ann').cash).toBe(2750);
    s = act(s, { type: 'UNMORTGAGE', player: 'ann', space: 39 }).state;
    expect(player(s, 'ann').cash).toBe(2750 - 275);
  });

  it('opens a crisis when you cannot pay, and settles once you raise the money', () => {
    let s = edit(own(own(newGame(), 'bo', 3), 'ann', 39), (d) => {
      d.players[0]!.cash = 5;
    });
    s = roll(s, 1, 2).state;
    expect(s.phase).toMatchObject({ kind: 'crisis', debtor: 'ann', amount: 10 });
    s = act(s, { type: 'MORTGAGE', player: 'ann', space: 39 }).state;
    expect(s.phase.kind).toBe('turnEnd');
    expect(player(s, 'ann').cash).toBe(5 + 250 - 10);
    expect(player(s, 'bo').cash).toBe(2510);
  });

  it('bankrupts the debtor when the crisis window ends, and the last player wins', () => {
    let s = edit(own(own(newGame(), 'bo', 3), 'ann', 1), (d) => {
      d.players[0]!.cash = 5;
    });
    s = roll(s, 1, 2).state;
    s = act(s, { type: 'TICK', now: T0 + 60_000 }).state;
    expect(player(s, 'ann').bankrupt).toBe(true);
    expect(s.properties[1]?.owner).toBe('bo');
    expect(player(s, 'bo').cash).toBe(2505);
    expect(s.phase).toEqual({ kind: 'gameOver', winners: ['bo'], reason: 'lastStanding' });
  });

  it('returns properties to the bank on bankruptcy to the bank, and play continues', () => {
    let s = edit(own(newGame(3), 'ann', 1), (d) => {
      d.players[0]!.cash = 50;
      d.players[0]!.position = 36;
    });
    s = roll(s, 1, 1).state; // 38 Trängselskatt 150
    s = act(s, { type: 'DECLARE_BANKRUPTCY', player: 'ann' }).state;
    expect(s.properties[1]?.owner).toBeNull();
    expect(s.turn.current).toBe('bo');
  });
});

describe('trading', () => {
  const offer = { cash: 100, spaces: [] as number[], items: [] as never[] };

  it('needs something from both sides', () => {
    const s = own(newGame(), 'bo', 3);
    expect(
      refused(s, {
        type: 'PROPOSE_TRADE',
        player: 'ann',
        to: 'bo',
        give: offer,
        get: { cash: 0, spaces: [], items: [] },
      }),
    ).toMatch(/Both sides/);
  });

  it('swaps cash for a street when accepted', () => {
    let s = own(newGame(), 'bo', 3);
    s = act(s, {
      type: 'PROPOSE_TRADE',
      player: 'ann',
      to: 'bo',
      give: offer,
      get: { cash: 0, spaces: [3], items: [] },
    }).state;
    expect(
      refused(s, {
        type: 'PROPOSE_TRADE',
        player: 'ann',
        to: 'bo',
        give: offer,
        get: { cash: 0, spaces: [3], items: [] },
      }),
    ).toMatch(/open offer/);
    const id = s.trades[0]!.id;
    s = act(s, { type: 'RESPOND_TRADE', player: 'bo', tradeId: id, response: 'accept' }).state;
    expect(s.properties[3]?.owner).toBe('ann');
    expect(player(s, 'ann').cash).toBe(2400);
    expect(s.trades).toEqual([]);
  });

  it('expires offers after 30 seconds and supports counters', () => {
    let s = own(newGame(), 'bo', 3);
    const propose = {
      type: 'PROPOSE_TRADE' as const,
      player: 'ann',
      to: 'bo',
      give: offer,
      get: { cash: 0, spaces: [3], items: [] },
    };
    s = act(s, propose).state;
    s = act(s, {
      type: 'RESPOND_TRADE',
      player: 'bo',
      tradeId: s.trades[0]!.id,
      response: 'counter',
      counter: { give: { cash: 0, spaces: [3], items: [] }, get: { ...offer, cash: 200 } },
    }).state;
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0]).toMatchObject({ from: 'bo', to: 'ann' });
    s = act(s, { type: 'TICK', now: T0 + 30_000 }).state;
    expect(s.trades).toEqual([]);
  });

  it('limits players to three offers per turn', () => {
    let s = own(newGame(), 'bo', 3);
    for (let i = 0; i < 3; i++) {
      s = act(s, {
        type: 'PROPOSE_TRADE',
        player: 'ann',
        to: 'bo',
        give: offer,
        get: { cash: 0, spaces: [3], items: [] },
      }).state;
      s = act(s, {
        type: 'RESPOND_TRADE',
        player: 'bo',
        tradeId: s.trades[0]!.id,
        response: 'decline',
      }).state;
    }
    expect(
      refused(s, {
        type: 'PROPOSE_TRADE',
        player: 'ann',
        to: 'bo',
        give: offer,
        get: { cash: 0, spaces: [3], items: [] },
      }),
    ).toMatch(/most offers/);
  });
});

describe('special spaces and cards', () => {
  it('sends you to Arresten from the ticket inspector on a 1 or 2', () => {
    // Search seeds for one where the inspector die shows 1 or 2, and one where it doesn't.
    const outcomes = new Set<boolean>();
    for (let seed = 0; seed < 20 && outcomes.size < 2; seed++) {
      let s = edit(newGame(), (d) => {
        d.players[0]!.position = 32;
        d.seed = seed;
      });
      s = roll(s, 1, 2).state;
      outcomes.add(player(s, 'ann').inJail);
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it('takes 10% of cash at Skatteverket, at least 100 kr', () => {
    let s = edit(newGame(), (d) => {
      d.players[0]!.position = 6;
    });
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').cash).toBe(2250);
  });

  it('gives an item at FIKA and asks for a discard when holding three', () => {
    let s = edit(newGame(), (d) => {
      d.players[0]!.position = 17;
      d.players[0]!.items = ['advokat', 'advokat', 'advokat'];
    });
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').pendingItem).not.toBeNull();
    expect(refused(s, { type: 'END_TURN', player: 'ann' })).toMatch(/discard/);
    s = act(s, { type: 'DISCARD_ITEM', player: 'ann', item: 'advokat' }).state;
    expect(player(s, 'ann').items).toHaveLength(3);
    expect(player(s, 'ann').pendingItem).toBeNull();
  });

  it('applies the top card and moves it to the bottom', () => {
    const cardIndex = CARDS.findIndex((c) => c.title === 'Swish från mormor');
    let s = edit(newGame(), (d) => {
      d.players[0]!.position = 3;
      d.deck = [cardIndex, ...d.deck.filter((x) => x !== cardIndex)];
    });
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').cash).toBe(2600);
    expect(s.deck.at(-1)).toBe(cardIndex);
  });

  it('hops anywhere from Ö-HOPP for 100 kr', () => {
    let s = edit(newGame(), (d) => {
      d.players[0]!.position = 27;
    });
    s = roll(s, 1, 2).state;
    expect(s.phase.kind).toBe('ohopp');
    expect(refused(s, { type: 'HOP', player: 'ann', to: 30 })).toMatch(/street/);
    s = act(s, { type: 'HOP', player: 'ann', to: 39 }).state;
    expect(player(s, 'ann').position).toBe(39);
    expect(player(s, 'ann').cash).toBe(2400);
    expect(s.phase).toEqual({ kind: 'awaitingBuyDecision', space: 39 });
  });
});

describe('items', () => {
  it('Dubbeltärning rolls three dice and keeps two', () => {
    let s = edit(newGame(), (d) => {
      d.players[0]!.items = ['dubbeltarning'];
    });
    s = act(s, { type: 'ROLL', player: 'ann', useItem: 'dubbeltarning', dice: [1, 2, 6] }).state;
    expect(s.phase.kind).toBe('chooseDice');
    s = act(s, { type: 'CHOOSE_DICE', player: 'ann', keep: [1, 2] }).state;
    expect(player(s, 'ann').position).toBe(8);
  });

  it('Snöplog shortens a move by up to 3', () => {
    let s = edit(newGame(), (d) => {
      d.players[0]!.items = ['snoplog'];
    });
    s = roll(s, 3, 4).state;
    expect(s.phase.kind).toBe('adjustMove');
    s = act(s, { type: 'ADJUST_MOVE', player: 'ann', reduceBy: 2 }).state;
    expect(player(s, 'ann').position).toBe(5);
    expect(player(s, 'ann').items).toEqual([]);
  });

  it('Hyresfrihet cancels a rent payment', () => {
    let s = edit(own(newGame(), 'bo', 3), (d) => {
      d.players[0]!.items = ['hyresfrihet'];
    });
    s = roll(s, 1, 2).state;
    expect(s.phase.kind).toBe('rentChoice');
    s = act(s, { type: 'USE_ITEM', player: 'ann', item: 'hyresfrihet' }).state;
    expect(player(s, 'ann').cash).toBe(2500);
  });

  it('SL-kort moves to the next T-station', () => {
    const s = edit(newGame(), (d) => {
      d.players[0]!.items = ['slkort'];
    });
    const out = act(s, { type: 'USE_ITEM', player: 'ann', item: 'slkort' }).state;
    expect(player(out, 'ann').position).toBe(4);
  });

  it('Advokat frees you from Arresten', () => {
    const s = edit(newGame(), (d) => {
      d.players[0]!.position = 10;
      d.players[0]!.inJail = true;
      d.players[0]!.items = ['advokat'];
    });
    const out = act(s, { type: 'USE_ITEM', player: 'ann', item: 'advokat' }).state;
    expect(player(out, 'ann').inJail).toBe(false);
    expect(out.phase.kind).toBe('awaitingRoll');
  });
});

describe('minigames', () => {
  it('pays 150 kr and an item to 1st, 75 kr to 2nd', () => {
    let s = roll(newGame(3), 1, 1).state; // lands on Minispel
    expect(s.phase.kind).toBe('minigame');
    s = act(s, { type: 'MINIGAME_RESULT', scores: { ann: 3, bo: 9, cy: 5 } }).state;
    expect(player(s, 'bo').cash).toBe(2650);
    expect(player(s, 'bo').items).toHaveLength(1);
    expect(player(s, 'cy').cash).toBe(2575);
    expect(player(s, 'ann').cash).toBe(2500);
    expect(s.phase.kind).toBe('awaitingRoll'); // ann rolled a double
  });

  it('splits the prize between tied players', () => {
    let s = roll(newGame(3), 1, 1).state;
    s = act(s, { type: 'MINIGAME_RESULT', scores: { ann: 5, bo: 5, cy: 1 } }).state;
    expect(player(s, 'ann').cash).toBe(2575);
    expect(player(s, 'bo').cash).toBe(2575);
  });

  it('holds a round final after every 5th round', () => {
    let s = edit(newGame(), (d) => {
      d.round = 5;
      d.turn.current = 'bo';
      d.phase = { kind: 'turnEnd' };
    });
    s = act(s, { type: 'END_TURN', player: 'bo' }).state;
    expect(s.round).toBe(6);
    expect(s.phase).toMatchObject({ kind: 'minigame', reason: 'roundFinal' });
    s = act(s, { type: 'MINIGAME_RESULT', scores: { ann: 1, bo: 2 } }).state;
    expect(player(s, 'bo').cash).toBe(2700);
    expect(player(s, 'ann').cash).toBe(2600);
    expect(s.turn.current).toBe('ann');
  });
});

describe('game length', () => {
  it('raises rent by 50% and cuts START pay in rush hour', () => {
    let s = own(newGame(), 'bo', 3);
    s = act(s, { type: 'ROLL', player: 'ann', dice: [1, 2], now: T0 + 45 * MIN }).state;
    expect(player(s, 'ann').cash).toBe(2485);

    s = edit(newGame(), (d) => {
      d.round = 15;
      d.players[0]!.position = 38;
    });
    s = roll(s, 1, 2).state;
    expect(player(s, 'ann').cash).toBe(2600);
  });

  it('ends at the end of a round after 75 minutes, richest player winning', () => {
    let s = edit(own(newGame(), 'bo', 39), (d) => {
      d.turn.current = 'bo';
      d.phase = { kind: 'turnEnd' };
    });
    s = act(s, { type: 'END_TURN', player: 'bo', now: T0 + 75 * MIN }).state;
    expect(s.phase).toEqual({ kind: 'gameOver', winners: ['bo'], reason: 'backstop' });
  });
});
