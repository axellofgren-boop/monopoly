/**
 * The Hometown reducer. `applyAction` validates an action against the rules, applies it to a
 * copy of the state and returns the new state with the events that happened.
 *
 * Internally a `Turn` context wraps the draft state, the RNG, the action time and the event
 * list, so each rule reads as a short method. Every rule-breaking request throws `RuleError`,
 * which `applyAction` turns into `{ ok: false }` with the original state untouched.
 */
import {
  BOARD_SIZE,
  JAIL_INDEX,
  SKATTEVERKET_MIN,
  SKATTEVERKET_RATE,
  TRANGSELSKATT,
  groupMembers,
  isOwnable,
  nextSpaceOfKind,
  spaceAt,
} from './board.js';
import { CARDS, ITEMS } from './cards.js';
import { Rng } from './rng.js';
import {
  alivePlayers,
  buildLevel,
  elapsedMinutes,
  getProperty,
  groupHasBuildings,
  isRushHour,
  mortgageValue,
  netWorth,
  ownsWholeGroup,
  propertiesOf,
  rentFor,
  transferFee,
  unmortgageCost,
} from './rules.js';
import type {
  Action,
  ApplyResult,
  Continuation,
  Creditor,
  GameEvent,
  GameState,
  ItemKind,
  Phase,
  Player,
  PlayerId,
  TradeOffer,
  TradeSide,
} from './types.js';

export class RuleError extends Error {}

/** Game state is plain JSON by design (it is sent over the wire), so a JSON copy is exact. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const fail = (message: string): never => {
  throw new RuleError(message);
};

export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.phase.kind === 'gameOver') return { ok: false, error: 'The game is over' };
  try {
    const turn = new Turn(clone(state), action.now);
    turn.dispatch(action);
    return { ok: true, state: turn.finish(), events: turn.events };
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, error: err.message };
    throw err;
  }
}

interface LandingOptions {
  diceTotal: number;
  doubleRent?: boolean;
  /** A card moved you onto a utility: roll again to set the rent. */
  rerollForUtility?: boolean;
}

class Turn {
  readonly events: GameEvent[] = [];
  private readonly rng: Rng;

  constructor(
    private readonly s: GameState,
    private readonly now: number,
  ) {
    this.rng = new Rng(s.seed);
  }

  finish(): GameState {
    this.s.seed = this.rng.seed;
    return this.s;
  }

  // ---------------------------------------------------------------- dispatch

  dispatch(a: Action): void {
    switch (a.type) {
      case 'TICK':
        return this.tick();
      case 'MINIGAME_RESULT':
        return this.minigameResult(a.scores);
      case 'ROLL':
        return this.roll(a.player, a.useItem, a.dice);
      case 'CHOOSE_DICE':
        return this.chooseDice(a.player, a.keep);
      case 'ADJUST_MOVE':
        return this.adjustMove(a.player, a.reduceBy);
      case 'BUY':
        return this.buy(a.player);
      case 'DECLINE_BUY':
        return this.declineBuy(a.player);
      case 'PAY_RENT':
        return this.payRent(a.player);
      case 'PAY_JAIL_FINE':
        return this.payJailFine(a.player);
      case 'USE_ITEM':
        return this.useItem(a.player, a.item);
      case 'DISCARD_ITEM':
        return this.discardItem(a.player, a.item);
      case 'HOP':
        return this.hop(a.player, a.to);
      case 'STAY':
        return this.stay(a.player);
      case 'BUILD':
        return this.build(a.player, a.space);
      case 'SELL_BUILDING':
        return this.sellBuilding(a.player, a.space);
      case 'MORTGAGE':
        return this.mortgage(a.player, a.space);
      case 'UNMORTGAGE':
        return this.unmortgage(a.player, a.space);
      case 'PROPOSE_TRADE':
        return this.proposeTrade(a.player, a.to, a.give, a.get, false);
      case 'RESPOND_TRADE':
        return this.respondTrade(a.player, a.tradeId, a.response, a.counter);
      case 'DECLARE_BANKRUPTCY':
        return this.declareBankruptcy(a.player);
      case 'END_TURN':
        return this.endTurn(a.player);
    }
  }

  // ---------------------------------------------------------------- helpers

  private player(id: PlayerId): Player {
    return this.s.players.find((p) => p.id === id) ?? fail(`Unknown player ${id}`);
  }

  private get current(): Player {
    return this.player(this.s.turn.current);
  }

  private requireCurrent(id: PlayerId, ...phases: Phase['kind'][]): Player {
    if (this.s.turn.current !== id) fail('It is not your turn');
    if (phases.length && !phases.includes(this.s.phase.kind)) fail('You cannot do that right now');
    return this.current;
  }

  /** Building, selling, mortgaging and trading are allowed on your own turn or in your crisis. */
  private requireManage(id: PlayerId): Player {
    const ph = this.s.phase;
    if (ph.kind === 'crisis' && ph.debtor === id) return this.player(id);
    return this.requireCurrent(id, 'awaitingRoll', 'turnEnd');
  }

  private setPhase(phase: Phase): void {
    this.s.phase = phase;
    this.s.turn.deadline = this.now + this.s.config.turnSeconds * 1000;
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
  }

  private credit(to: Creditor, amount: number): void {
    if (to !== 'bank') this.player(to).cash += amount;
  }

  /** Moves money that is known to be affordable. */
  private transfer(from: Creditor, to: Creditor, amount: number, reason: string): void {
    if (amount <= 0) return;
    if (from !== 'bank') {
      const p = this.player(from);
      if (p.cash < amount) fail('Not enough cash');
      p.cash -= amount;
    }
    this.credit(to, amount);
    this.emit({ type: 'paid', from, to, amount, reason });
  }

  /** Charges the current player; opens a crisis if they can't pay, then continues with `next`. */
  private charge(
    debtor: Player,
    creditor: Creditor,
    amount: number,
    reason: string,
    next: Continuation,
  ): void {
    if (debtor.cash >= amount) {
      this.transfer(debtor.id, creditor, amount, reason);
      this.run(next);
      return;
    }
    this.s.resume = next;
    this.s.phase = {
      kind: 'crisis',
      debtor: debtor.id,
      creditor,
      amount,
      endsAt: this.now + this.s.config.crisisSeconds * 1000,
    };
    this.emit({ type: 'crisis', player: debtor.id, amount });
  }

  /** Pays the crisis debt as soon as the debtor has raised enough cash. */
  private settleCrisisIfPossible(): void {
    const ph = this.s.phase;
    if (ph.kind !== 'crisis') return;
    const debtor = this.player(ph.debtor);
    if (debtor.cash < ph.amount) return;
    this.transfer(debtor.id, ph.creditor, ph.amount, 'debt');
    this.resume();
  }

  private resume(): void {
    const next = this.s.resume ?? { kind: 'continueTurn' };
    this.s.resume = null;
    this.run(next);
  }

  private run(next: Continuation): void {
    switch (next.kind) {
      case 'continueTurn':
        return this.continueTurn();
      case 'move':
        return this.moveBy(this.current, next.steps, { diceTotal: next.steps });
      case 'startTurn':
        return this.startTurn(next.player);
    }
  }

  // ---------------------------------------------------------------- turn flow

  /** After a space is resolved: roll again after a double, otherwise wait for END_TURN. */
  private continueTurn(): void {
    const p = this.current;
    if (p.bankrupt) return this.startNextTurn();
    if (this.s.turn.rollAgain && !p.inJail) {
      this.s.turn.rollAgain = false;
      this.setPhase({ kind: 'awaitingRoll' });
    } else {
      this.s.turn.rollAgain = false;
      this.setPhase({ kind: 'turnEnd' });
    }
  }

  private endTurn(id: PlayerId): void {
    const p = this.requireCurrent(id, 'turnEnd');
    if (p.pendingItem) fail('Choose an item to discard first');
    this.startNextTurn();
  }

  private startNextTurn(): void {
    const seats = this.s.players;
    const from = seats.findIndex((p) => p.id === this.s.turn.current);
    let nextIndex = -1;
    for (let step = 1; step <= seats.length; step++) {
      const i = (from + step) % seats.length;
      if (!seats[i]?.bankrupt) {
        nextIndex = i;
        break;
      }
    }
    const next = seats[nextIndex];
    if (!next) return this.gameOver([], 'lastStanding');
    if (nextIndex <= from) {
      this.s.round += 1;
      if (this.checkBackstop()) return;
      const every = this.s.config.roundFinalEvery;
      if (every > 0 && (this.s.round - 1) % every === 0) {
        this.startMinigame('roundFinal', { kind: 'startTurn', player: next.id });
        return;
      }
    }
    this.startTurn(next.id);
  }

  private startTurn(id: PlayerId): void {
    const p = this.player(id);
    p.offersThisTurn = 0;
    this.s.turn = { current: id, doublesInRow: 0, rollAgain: false, lastDice: null, deadline: 0 };
    this.setPhase({ kind: 'awaitingRoll' });
    if (!this.s.rushHourAnnounced && isRushHour(this.s, this.now)) {
      this.s.rushHourAnnounced = true;
      this.emit({ type: 'rushHour' });
    }
    this.emit({ type: 'turnStarted', player: id, round: this.s.round });
  }

  private checkBackstop(): boolean {
    const alive = alivePlayers(this.s);
    if (alive.length < 2 || elapsedMinutes(this.s, this.now) < this.s.config.backstopMinutes) {
      return false;
    }
    const scored = alive.map((p) => ({ p, worth: netWorth(this.s, p.id) }));
    const best = Math.max(...scored.map((x) => x.worth));
    let top = scored.filter((x) => x.worth === best);
    const bestCash = Math.max(...top.map((x) => x.p.cash));
    top = top.filter((x) => x.p.cash === bestCash);
    this.gameOver(
      top.map((x) => x.p.id),
      'backstop',
    );
    return true;
  }

  private gameOver(winners: PlayerId[], reason: 'lastStanding' | 'backstop'): void {
    this.s.phase = { kind: 'gameOver', winners, reason };
    this.emit({ type: 'gameOver', winners });
  }

  // ---------------------------------------------------------------- rolling & moving

  private rollDice(count: number, forced?: number[]): number[] {
    if (forced) {
      if (forced.length !== count || forced.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) {
        fail('Invalid forced dice');
      }
      return [...forced];
    }
    return Array.from({ length: count }, () => this.rng.die());
  }

  private roll(id: PlayerId, useItem?: 'dubbeltarning', forced?: number[]): void {
    const p = this.requireCurrent(id, 'awaitingRoll');
    if (p.pendingItem) fail('Choose an item to discard first');

    if (p.inJail) {
      const dice = this.rollDice(2, forced);
      this.s.turn.lastDice = dice;
      this.emit({ type: 'rolled', player: id, dice });
      const [a, b] = dice as [number, number];
      if (a === b) {
        this.release(p);
        this.moveBy(p, a + b, { diceTotal: a + b });
        return;
      }
      p.jailAttempts += 1;
      if (p.jailAttempts >= 3) {
        this.release(p);
        this.charge(p, 'bank', this.s.config.jailFine, 'Arresten fine', {
          kind: 'move',
          steps: a + b,
        });
        return;
      }
      this.setPhase({ kind: 'turnEnd' });
      return;
    }

    if (useItem === 'dubbeltarning') {
      this.consumeItem(p, 'dubbeltarning');
      const dice = this.rollDice(3, forced) as [number, number, number];
      this.emit({ type: 'rolled', player: id, dice });
      this.setPhase({ kind: 'chooseDice', dice });
      return;
    }
    this.afterDice(p, this.rollDice(2, forced) as [number, number]);
  }

  private chooseDice(id: PlayerId, keep: [number, number]): void {
    this.requireCurrent(id, 'chooseDice');
    const ph = this.s.phase as Extract<Phase, { kind: 'chooseDice' }>;
    const [i, j] = keep;
    if (i === j || ![i, j].every((k) => k >= 0 && k <= 2)) fail('Pick two different dice');
    this.afterDice(this.current, [ph.dice[i] as number, ph.dice[j] as number]);
  }

  private afterDice(p: Player, dice: [number, number]): void {
    this.s.turn.lastDice = dice;
    if (this.s.phase.kind !== 'chooseDice') {
      this.emit({ type: 'rolled', player: p.id, dice });
    }
    const isDouble = dice[0] === dice[1];
    if (isDouble) {
      this.s.turn.doublesInRow += 1;
      if (this.s.turn.doublesInRow >= 3) return this.sendToJail(p);
    }
    this.s.turn.rollAgain = isDouble;
    if (p.items.includes('snoplog')) {
      this.setPhase({ kind: 'adjustMove', dice });
      return;
    }
    const total = dice[0] + dice[1];
    this.moveBy(p, total, { diceTotal: total });
  }

  private adjustMove(id: PlayerId, reduceBy: number): void {
    const p = this.requireCurrent(id, 'adjustMove');
    if (!Number.isInteger(reduceBy) || reduceBy < 0 || reduceBy > 3) fail('Reduce by 0 to 3');
    const ph = this.s.phase as Extract<Phase, { kind: 'adjustMove' }>;
    const total = ph.dice[0] + ph.dice[1];
    if (reduceBy > 0) this.consumeItem(p, 'snoplog');
    this.moveBy(p, Math.max(0, total - reduceBy), { diceTotal: total });
  }

  /** Moves forward, paying for passing START, then resolves the landing space. */
  private moveBy(p: Player, steps: number, opts: LandingOptions): void {
    const from = p.position;
    const to = (from + steps) % BOARD_SIZE;
    // Landing exactly on START is payday (handled by landOn), so only a wrap past it pays here.
    const passedStart = from + steps >= BOARD_SIZE && to !== 0;
    p.position = to;
    this.emit({ type: 'moved', player: p.id, from, to, passedStart });
    if (passedStart) this.payPassStart(p);
    this.landOn(p, to, opts);
  }

  /** Moves forward to a target space (cards, items), paying for passing START. */
  private moveForwardTo(p: Player, target: number, opts: LandingOptions): void {
    const steps = (target - p.position + BOARD_SIZE) % BOARD_SIZE;
    this.moveBy(p, steps, opts);
  }

  private payPassStart(p: Player): void {
    const { passStart, rushHourPassStart } = this.s.config;
    const amount = isRushHour(this.s, this.now) ? rushHourPassStart : passStart;
    this.transfer('bank', p.id, amount, 'passed START');
  }

  private sendToJail(p: Player): void {
    p.position = JAIL_INDEX;
    p.inJail = true;
    p.jailAttempts = 0;
    this.s.turn.rollAgain = false;
    this.s.turn.doublesInRow = 0;
    this.emit({ type: 'jailed', player: p.id });
    this.setPhase({ kind: 'turnEnd' });
  }

  private release(p: Player): void {
    p.inJail = false;
    p.jailAttempts = 0;
    this.s.turn.rollAgain = false;
    this.emit({ type: 'released', player: p.id });
  }

  private payJailFine(id: PlayerId): void {
    const p = this.requireCurrent(id, 'awaitingRoll');
    if (!p.inJail) fail('You are not in Arresten');
    if (p.cash < this.s.config.jailFine) fail('Not enough cash for the fine');
    this.transfer(p.id, 'bank', this.s.config.jailFine, 'Arresten fine');
    this.release(p);
  }

  // ---------------------------------------------------------------- landing

  private landOn(p: Player, index: number, opts: LandingOptions): void {
    const space = spaceAt(index);
    switch (space.kind) {
      case 'start':
        this.transfer('bank', p.id, this.s.config.landOnStart, 'payday on START');
        return this.continueTurn();
      case 'street':
      case 'station':
      case 'utility':
        return this.landOnOwnable(p, index, opts);
      case 'jail':
      case 'ohopp':
        if (space.kind === 'ohopp') return this.setPhase({ kind: 'ohopp' });
        return this.continueTurn();
      case 'fika':
        this.gainItem(p, this.rng.pick(ITEMS));
        return this.continueTurn();
      case 'minigame':
        return this.startMinigame('space', { kind: 'continueTurn' });
      case 'card':
        return this.drawCard(p);
      case 'inspector': {
        const die = this.rng.die();
        this.emit({ type: 'rolled', player: p.id, dice: [die] });
        if (die <= 2) return this.sendToJail(p);
        return this.continueTurn();
      }
      case 'tax': {
        const amount =
          space.tax === 'flat'
            ? TRANGSELSKATT
            : Math.max(SKATTEVERKET_MIN, Math.round(p.cash * SKATTEVERKET_RATE));
        return this.charge(p, 'bank', amount, space.name, { kind: 'continueTurn' });
      }
    }
  }

  private landOnOwnable(p: Player, index: number, opts: LandingOptions): void {
    const prop = getProperty(this.s, index);
    if (!prop.owner) return this.setPhase({ kind: 'awaitingBuyDecision', space: index });
    if (prop.owner === p.id || prop.mortgaged) return this.continueTurn();
    let diceTotal = opts.diceTotal;
    if (opts.rerollForUtility && spaceAt(index).kind === 'utility') {
      const dice = this.rollDice(2);
      this.emit({ type: 'rolled', player: p.id, dice });
      diceTotal = (dice[0] as number) + (dice[1] as number);
    }
    const amount = rentFor(this.s, index, {
      diceTotal,
      now: this.now,
      doubleRent: opts.doubleRent ?? false,
    });
    if (amount <= 0) return this.continueTurn();
    if (p.items.includes('hyresfrihet')) {
      return this.setPhase({ kind: 'rentChoice', space: index, amount, owner: prop.owner });
    }
    this.charge(p, prop.owner, amount, `rent for ${spaceAt(index).name}`, {
      kind: 'continueTurn',
    });
  }

  private payRent(id: PlayerId): void {
    const p = this.requireCurrent(id, 'rentChoice');
    const ph = this.s.phase as Extract<Phase, { kind: 'rentChoice' }>;
    this.charge(p, ph.owner, ph.amount, `rent for ${spaceAt(ph.space).name}`, {
      kind: 'continueTurn',
    });
  }

  // ---------------------------------------------------------------- buying

  private buy(id: PlayerId): void {
    const p = this.requireCurrent(id, 'awaitingBuyDecision');
    const ph = this.s.phase as Extract<Phase, { kind: 'awaitingBuyDecision' }>;
    const space = spaceAt(ph.space);
    if (!isOwnable(space)) return fail('Not for sale');
    if (p.cash < space.price) fail('Not enough cash');
    this.transfer(p.id, 'bank', space.price, `bought ${space.name}`);
    getProperty(this.s, ph.space).owner = p.id;
    this.emit({ type: 'bought', player: p.id, space: ph.space, price: space.price });
    this.continueTurn();
  }

  /** Not buying leaves the place with the bank; the next player to land there can buy it. */
  private declineBuy(id: PlayerId): void {
    this.requireCurrent(id, 'awaitingBuyDecision');
    const ph = this.s.phase as Extract<Phase, { kind: 'awaitingBuyDecision' }>;
    this.emit({ type: 'declinedBuy', player: id, space: ph.space });
    this.continueTurn();
  }

  // ---------------------------------------------------------------- special spaces

  private hop(id: PlayerId, to: number): void {
    const p = this.requireCurrent(id, 'ohopp');
    if (!Number.isInteger(to) || to < 0 || to >= BOARD_SIZE || !isOwnable(spaceAt(to))) {
      fail('Hop to a street, station or utility');
    }
    if (p.cash < this.s.config.ohoppFee) fail('Not enough cash to hop');
    this.transfer(p.id, 'bank', this.s.config.ohoppFee, 'Ö-HOPP');
    const from = p.position;
    p.position = to;
    this.emit({ type: 'moved', player: p.id, from, to, passedStart: false });
    this.landOn(p, to, { diceTotal: this.lastDiceTotal(), rerollForUtility: true });
  }

  private stay(id: PlayerId): void {
    this.requireCurrent(id, 'ohopp');
    this.continueTurn();
  }

  private lastDiceTotal(): number {
    return (this.s.turn.lastDice ?? []).slice(0, 2).reduce((a, b) => a + b, 0);
  }

  private drawCard(p: Player): void {
    const cardIndex = this.s.deck.shift();
    if (cardIndex === undefined) return this.continueTurn();
    this.s.deck.push(cardIndex);
    const card = CARDS[cardIndex];
    if (!card) return this.continueTurn();
    this.emit({ type: 'card', player: p.id, card: card.title });
    const e = card.effect;
    const cardMove: LandingOptions = { diceTotal: this.lastDiceTotal(), rerollForUtility: true };
    switch (e.kind) {
      case 'collect':
        this.transfer('bank', p.id, e.amount, card.title);
        return this.continueTurn();
      case 'pay':
        return this.charge(p, 'bank', e.amount, card.title, { kind: 'continueTurn' });
      case 'everyoneCollects':
        for (const q of alivePlayers(this.s)) this.transfer('bank', q.id, e.amount, card.title);
        return this.continueTurn();
      case 'othersPayYou':
        // Players who can't afford it pay what they have; the rest is forgiven.
        for (const q of alivePlayers(this.s)) {
          if (q.id !== p.id) this.transfer(q.id, p.id, Math.min(q.cash, e.amount), card.title);
        }
        return this.continueTurn();
      case 'repairs': {
        let houses = 0;
        let landmarks = 0;
        for (const i of propertiesOf(this.s, p.id)) {
          const prop = getProperty(this.s, i);
          houses += prop.houses;
          landmarks += prop.landmark ? 1 : 0;
        }
        const amount = houses * e.perHouse + landmarks * e.perLandmark;
        return this.charge(p, 'bank', amount, card.title, { kind: 'continueTurn' });
      }
      case 'moveBack': {
        const from = p.position;
        p.position = (from - e.spaces + BOARD_SIZE) % BOARD_SIZE;
        this.emit({ type: 'moved', player: p.id, from, to: p.position, passedStart: false });
        return this.landOn(p, p.position, cardMove);
      }
      case 'nextMinigame':
        return this.moveForwardTo(p, nextSpaceOfKind(p.position, 'minigame'), cardMove);
      case 'nextStationDoubleRent':
        return this.moveForwardTo(p, nextSpaceOfKind(p.position, 'station'), {
          ...cardMove,
          doubleRent: true,
        });
      case 'moveTo':
        return this.moveForwardTo(p, e.space, cardMove);
      case 'goToJail':
        return this.sendToJail(p);
      case 'gainItem':
        this.gainItem(p, e.item);
        return this.continueTurn();
    }
  }

  // ---------------------------------------------------------------- items

  private gainItem(p: Player, item: ItemKind): void {
    if (p.items.length < this.s.config.maxItems) p.items.push(item);
    else p.pendingItem = item;
    this.emit({ type: 'item', player: p.id, item, gained: true });
  }

  private consumeItem(p: Player, item: ItemKind): void {
    const i = p.items.indexOf(item);
    if (i < 0) fail('You do not have that item');
    p.items.splice(i, 1);
    this.emit({ type: 'item', player: p.id, item, gained: false });
  }

  private discardItem(id: PlayerId, item: ItemKind): void {
    const p = this.player(id);
    if (!p.pendingItem) fail('You have no extra item to discard');
    const pending = p.pendingItem as ItemKind;
    if (item !== pending) {
      const i = p.items.indexOf(item);
      if (i < 0) fail('You do not have that item');
      p.items.splice(i, 1, pending);
    }
    p.pendingItem = null;
  }

  private useItem(id: PlayerId, item: 'slkort' | 'advokat' | 'hyresfrihet'): void {
    if (item === 'hyresfrihet') {
      const p = this.requireCurrent(id, 'rentChoice');
      this.consumeItem(p, 'hyresfrihet');
      return this.continueTurn();
    }
    const p = this.requireCurrent(id, 'awaitingRoll');
    if (p.pendingItem) fail('Choose an item to discard first');
    if (item === 'advokat') {
      if (!p.inJail) fail('You are not in Arresten');
      this.consumeItem(p, 'advokat');
      return this.release(p);
    }
    if (p.inJail) fail('You are in Arresten');
    this.consumeItem(p, 'slkort');
    this.s.turn.rollAgain = false;
    this.moveForwardTo(p, nextSpaceOfKind(p.position, 'station'), { diceTotal: 0 });
  }

  // ---------------------------------------------------------------- minigames

  private startMinigame(reason: 'space' | 'roundFinal', next: Continuation): void {
    this.s.resume = next;
    this.s.phase = {
      kind: 'minigame',
      reason,
      players: alivePlayers(this.s).map((p) => p.id),
      endsAt: this.now + (this.s.config.minigameSeconds + 10) * 1000,
    };
    this.emit({ type: 'minigameStarted', reason });
  }

  private minigameResult(scores: Record<PlayerId, number>): void {
    const ph = this.s.phase;
    if (ph.kind !== 'minigame') return fail('No minigame is running');
    // Group players by score, best first; ties share a place.
    const byScore = new Map<number, PlayerId[]>();
    for (const id of ph.players) {
      const score = scores[id] ?? 0;
      byScore.set(score, [...(byScore.get(score) ?? []), id]);
    }
    const ranking = [...byScore.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids);
    this.emit({ type: 'minigameResult', ranking });

    const share = (ids: PlayerId[] | undefined, total: number, why: string) => {
      if (!ids?.length) return;
      const each = Math.floor(total / ids.length);
      for (const id of ids) this.transfer('bank', id, each, why);
    };
    const itemTo = (ids: PlayerId[] | undefined) => {
      if (ids?.length) this.gainItem(this.player(this.rng.pick(ids)), this.rng.pick(ITEMS));
    };
    if (ranking.length > 1) {
      if (ph.reason === 'space') {
        share(ranking[0], 150, 'minigame 1st place');
        itemTo(ranking[0]);
        share(ranking[1], 75, 'minigame 2nd place');
      } else {
        share(ranking[0], 200, 'round final 1st place');
        share(ranking[1], 100, 'round final 2nd place');
        itemTo(ranking[ranking.length - 1]);
      }
    }
    this.resume();
  }

  // ---------------------------------------------------------------- building & mortgages

  private ownedStreet(p: Player, index: number) {
    const space = spaceAt(index);
    if (space.kind !== 'street') return fail('Only streets can have buildings');
    const prop = getProperty(this.s, index);
    if (prop.owner !== p.id) fail('You do not own that street');
    return { space, prop };
  }

  private build(id: PlayerId, index: number): void {
    const p = this.requireCurrent(id, 'awaitingRoll', 'turnEnd');
    const { space, prop } = this.ownedStreet(p, index);
    if (!ownsWholeGroup(this.s, index, id)) fail('You need the whole colour group');
    const group = groupMembers(space.group).map((i) => getProperty(this.s, i));
    if (group.some((g) => g.mortgaged)) fail('Lift the mortgages in this group first');
    if (prop.landmark) fail('This street already has a landmark');
    const minLevel = Math.min(...group.map(buildLevel));
    if (buildLevel(prop) > minLevel) fail('Build evenly across the group');

    if (prop.houses < 3) {
      if (this.s.bank.houses < 1) fail('The bank has no houses left');
      let cost = space.houseCost;
      if (p.items.includes('byggrabatt')) {
        this.consumeItem(p, 'byggrabatt');
        cost = Math.ceil(cost / 2);
      }
      if (p.cash < cost) fail('Not enough cash');
      this.transfer(p.id, 'bank', cost, `house on ${space.name}`);
      prop.houses += 1;
      this.s.bank.houses -= 1;
      this.emit({ type: 'built', player: id, space: index, landmark: false });
      return;
    }
    if (this.s.bank.landmarks < 1) fail('The bank has no landmarks left');
    const cost = space.houseCost * 2;
    if (p.cash < cost) fail('Not enough cash');
    this.transfer(p.id, 'bank', cost, `landmark on ${space.name}`);
    prop.houses = 0;
    prop.landmark = true;
    this.s.bank.houses += 3;
    this.s.bank.landmarks -= 1;
    this.emit({ type: 'built', player: id, space: index, landmark: true });
  }

  private sellBuilding(id: PlayerId, index: number): void {
    const p = this.requireManage(id);
    const { space, prop } = this.ownedStreet(p, index);
    const group = groupMembers(space.group).map((i) => getProperty(this.s, i));
    const level = buildLevel(prop);
    if (level === 0) fail('No buildings to sell');
    if (level < Math.max(...group.map(buildLevel))) fail('Sell evenly across the group');
    let refund: number;
    if (prop.landmark) {
      refund = Math.floor((space.houseCost * 2) / 2 + (space.houseCost * 3) / 2);
      prop.landmark = false;
      this.s.bank.landmarks += 1;
    } else {
      refund = Math.floor(space.houseCost / 2);
      prop.houses -= 1;
      this.s.bank.houses += 1;
    }
    this.transfer('bank', p.id, refund, `sold building on ${space.name}`);
    this.emit({ type: 'sold', player: id, space: index, refund });
    this.settleCrisisIfPossible();
  }

  private mortgage(id: PlayerId, index: number): void {
    const p = this.requireManage(id);
    const prop = this.ownedProperty(p, index);
    if (prop.mortgaged) fail('Already mortgaged');
    if (groupHasBuildings(this.s, index)) fail('Sell the buildings in this group first');
    prop.mortgaged = true;
    this.transfer('bank', p.id, mortgageValue(index), `mortgaged ${spaceAt(index).name}`);
    this.emit({ type: 'mortgaged', player: id, space: index, unmortgaged: false });
    this.settleCrisisIfPossible();
  }

  private unmortgage(id: PlayerId, index: number): void {
    const p = this.requireCurrent(id, 'awaitingRoll', 'turnEnd');
    const prop = this.ownedProperty(p, index);
    if (!prop.mortgaged) fail('Not mortgaged');
    const cost = unmortgageCost(index);
    if (p.cash < cost) fail('Not enough cash');
    this.transfer(p.id, 'bank', cost, `lifted mortgage on ${spaceAt(index).name}`);
    prop.mortgaged = false;
    this.emit({ type: 'mortgaged', player: id, space: index, unmortgaged: true });
  }

  private ownedProperty(p: Player, index: number) {
    if (!isOwnable(spaceAt(index))) fail('That space cannot be owned');
    const prop = getProperty(this.s, index);
    if (prop.owner !== p.id) fail('You do not own that property');
    return prop;
  }

  // ---------------------------------------------------------------- trading

  private validateSide(owner: Player, side: TradeSide): void {
    if (!Number.isInteger(side.cash) || side.cash < 0)
      fail('Cash must be a whole, positive amount');
    if (side.cash > owner.cash) fail(`${owner.name} does not have that much cash`);
    if (new Set(side.spaces).size !== side.spaces.length) fail('A property is listed twice');
    for (const i of side.spaces) {
      if (!isOwnable(spaceAt(i))) fail('That space cannot be traded');
      if (getProperty(this.s, i).owner !== owner.id) fail(`${owner.name} does not own that`);
      if (groupHasBuildings(this.s, i)) fail('Streets in a group with buildings cannot be traded');
    }
    const counts = new Map<ItemKind, number>();
    for (const item of side.items) counts.set(item, (counts.get(item) ?? 0) + 1);
    for (const [item, n] of counts) {
      if (owner.items.filter((x) => x === item).length < n) fail(`${owner.name} lacks that item`);
    }
  }

  private isEmpty(side: TradeSide): boolean {
    return side.cash === 0 && side.spaces.length === 0 && side.items.length === 0;
  }

  private proposeTrade(
    id: PlayerId,
    to: PlayerId,
    give: TradeSide,
    get: TradeSide,
    isCounter: boolean,
  ): void {
    const p = isCounter ? this.player(id) : this.requireManage(id);
    const other = this.player(to);
    if (other.id === p.id || other.bankrupt || p.bankrupt) fail('Pick another player in the game');
    if (this.isEmpty(give) || this.isEmpty(get)) fail('Both sides must give something');
    if (this.s.trades.some((t) => t.from === id)) fail('You already have an open offer');
    if (!isCounter && p.offersThisTurn >= this.s.config.maxOffersPerTurn) {
      fail('You have sent the most offers allowed this turn');
    }
    this.validateSide(p, give);
    this.validateSide(other, get);
    if (!isCounter) p.offersThisTurn += 1;
    const trade: TradeOffer = {
      id: this.s.nextTradeId++,
      from: id,
      to,
      give: clone(give),
      get: clone(get),
      expiresAt: this.now + this.s.config.tradeSeconds * 1000,
    };
    this.s.trades.push(trade);
    this.emit({ type: 'tradeProposed', trade });
  }

  private respondTrade(
    id: PlayerId,
    tradeId: number,
    response: 'accept' | 'decline' | 'counter',
    counter?: { give: TradeSide; get: TradeSide },
  ): void {
    const trade = this.s.trades.find((t) => t.id === tradeId);
    if (!trade || trade.to !== id) return fail('No such offer for you');
    this.s.trades = this.s.trades.filter((t) => t.id !== tradeId);
    if (response === 'decline') {
      this.emit({ type: 'tradeResolved', tradeId, outcome: 'declined' });
      return;
    }
    if (response === 'counter') {
      if (!counter) return fail('A counter needs new terms');
      this.emit({ type: 'tradeResolved', tradeId, outcome: 'countered' });
      return this.proposeTrade(id, trade.from, counter.give, counter.get, true);
    }
    this.executeTrade(trade);
    this.emit({ type: 'tradeResolved', tradeId, outcome: 'accepted' });
    this.settleCrisisIfPossible();
  }

  private executeTrade(t: TradeOffer): void {
    const from = this.player(t.from);
    const to = this.player(t.to);
    this.validateSide(from, t.give);
    this.validateSide(to, t.get);
    // Mortgaged properties carry a 10% transfer fee for the receiver; check it is affordable.
    const fees = (side: TradeSide) =>
      side.spaces
        .filter((i) => getProperty(this.s, i).mortgaged)
        .reduce((sum, i) => sum + transferFee(i), 0);
    const feeTo = fees(t.give);
    const feeFrom = fees(t.get);
    if (to.cash - t.get.cash + t.give.cash < feeTo) fail(`${to.name} cannot cover mortgage fees`);
    if (from.cash - t.give.cash + t.get.cash < feeFrom) {
      fail(`${from.name} cannot cover mortgage fees`);
    }
    const move = (a: Player, b: Player, side: TradeSide) => {
      if (side.cash) this.transfer(a.id, b.id, side.cash, 'trade');
      for (const i of side.spaces) getProperty(this.s, i).owner = b.id;
      for (const item of side.items) {
        a.items.splice(a.items.indexOf(item), 1);
        this.gainItem(b, item);
      }
    };
    move(from, to, t.give);
    move(to, from, t.get);
    if (feeTo) this.transfer(to.id, 'bank', feeTo, 'mortgage transfer fee');
    if (feeFrom) this.transfer(from.id, 'bank', feeFrom, 'mortgage transfer fee');
  }

  // ---------------------------------------------------------------- bankruptcy

  private declareBankruptcy(id: PlayerId): void {
    const ph = this.s.phase;
    if (ph.kind !== 'crisis' || ph.debtor !== id) return fail('You are not in a crisis');
    this.bankrupt(this.player(id), ph.creditor);
  }

  private bankrupt(p: Player, creditor: Creditor): void {
    const heir = creditor === 'bank' ? null : this.player(creditor);
    let buildingCash = 0;
    for (const i of propertiesOf(this.s, p.id)) {
      const space = spaceAt(i);
      const prop = getProperty(this.s, i);
      if (space.kind === 'street') {
        buildingCash += Math.floor((prop.houses * space.houseCost) / 2);
        this.s.bank.houses += prop.houses;
        if (prop.landmark) {
          buildingCash += Math.floor((space.houseCost * 5) / 2);
          this.s.bank.landmarks += 1;
        }
        prop.houses = 0;
        prop.landmark = false;
      }
      if (heir) {
        prop.owner = heir.id;
        if (prop.mortgaged) {
          const fee = Math.min(heir.cash, transferFee(i));
          if (fee) this.transfer(heir.id, 'bank', fee, 'mortgage transfer fee');
        }
      } else {
        prop.owner = null;
        prop.mortgaged = false;
      }
    }
    const total = p.cash + buildingCash;
    p.cash = 0;
    if (heir) {
      if (total) this.credit(heir.id, total);
      for (const item of p.items) this.gainItem(heir, item);
    }
    p.items = [];
    p.pendingItem = null;
    p.bankrupt = true;
    this.s.trades = this.s.trades.filter((t) => t.from !== p.id && t.to !== p.id);
    this.s.resume = null;
    this.emit({ type: 'bankrupt', player: p.id, creditor });

    const alive = alivePlayers(this.s);
    if (alive.length === 1) return this.gameOver([alive[0]?.id as PlayerId], 'lastStanding');
    if (this.s.turn.current === p.id) this.startNextTurn();
  }

  // ---------------------------------------------------------------- timers

  private tick(): void {
    const now = this.now;
    for (const t of this.s.trades.filter((x) => x.expiresAt <= now)) {
      this.emit({ type: 'tradeResolved', tradeId: t.id, outcome: 'expired' });
    }
    this.s.trades = this.s.trades.filter((t) => t.expiresAt > now);

    const ph = this.s.phase;
    switch (ph.kind) {
      case 'crisis':
        if (now >= ph.endsAt) this.bankrupt(this.player(ph.debtor), ph.creditor);
        return;
      case 'minigame':
        if (now >= ph.endsAt) this.resume(); // nobody reported scores: no prizes
        return;
      case 'gameOver':
        return;
      default:
        if (now >= this.s.turn.deadline) this.autoPlay();
    }
  }

  /** The current player ran out of time: take the safe default for the phase. */
  private autoPlay(): void {
    const p = this.current;
    if (p.pendingItem) this.discardItem(p.id, p.pendingItem);
    const ph = this.s.phase;
    switch (ph.kind) {
      case 'awaitingRoll':
        return this.roll(p.id);
      case 'chooseDice':
        return this.chooseDice(p.id, [0, 1]);
      case 'adjustMove':
        return this.adjustMove(p.id, 0);
      case 'awaitingBuyDecision':
        return this.declineBuy(p.id);
      case 'rentChoice':
        return this.payRent(p.id);
      case 'ohopp':
        return this.stay(p.id);
      case 'turnEnd':
        return this.endTurn(p.id);
    }
  }
}
