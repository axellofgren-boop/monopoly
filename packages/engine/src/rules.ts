/** Read-only rule queries over a game state. Nothing here mutates. */
import {
  BOARD,
  OWNABLE_INDICES,
  STATION_RENT,
  UTILITY_MULTIPLIER,
  groupMembers,
  isOwnable,
  spaceAt,
} from './board.js';
import type { GameState, Player, PlayerId, PropertyState } from './types.js';

export function getProperty(state: GameState, space: number): PropertyState {
  const prop = state.properties[space];
  if (!prop) throw new Error(`Space ${space} cannot be owned`);
  return prop;
}

export function findPlayer(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function alivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}

export function elapsedMinutes(state: GameState, now: number): number {
  return (now - state.startedAt) / 60_000;
}

export function isRushHour(state: GameState, now: number): boolean {
  const { rushHourMinutes, rushHourRound } = state.config;
  return elapsedMinutes(state, now) >= rushHourMinutes || state.round >= rushHourRound;
}

/** Building level used for even-building checks: houses, or 4 for a landmark. */
export function buildLevel(prop: PropertyState): number {
  return prop.landmark ? 4 : prop.houses;
}

export function ownsWholeGroup(state: GameState, space: number, owner: PlayerId): boolean {
  const s = spaceAt(space);
  if (s.kind !== 'street') return false;
  return groupMembers(s.group).every((i) => getProperty(state, i).owner === owner);
}

export function groupHasBuildings(state: GameState, space: number): boolean {
  const s = spaceAt(space);
  if (s.kind !== 'street') return false;
  return groupMembers(s.group).some((i) => buildLevel(getProperty(state, i)) > 0);
}

/** Rounds up to the next multiple of 5 kr. */
export const ceil5 = (n: number): number => Math.ceil(n / 5) * 5;

/**
 * Rent owed for landing on `space`, before items. Returns 0 when no rent is due.
 * `diceTotal` is needed for utilities.
 */
export function rentFor(
  state: GameState,
  space: number,
  opts: { diceTotal: number; now: number; doubleRent?: boolean },
): number {
  const s = spaceAt(space);
  const prop = state.properties[space];
  if (!prop || !prop.owner || prop.mortgaged) return 0;
  const owner = prop.owner;
  let rent: number;
  if (s.kind === 'street') {
    if (prop.landmark) rent = s.rent[5];
    else if (prop.houses > 0) rent = s.rent[1 + prop.houses] ?? 0;
    else rent = ownsWholeGroup(state, space, owner) ? s.rent[1] : s.rent[0];
  } else if (s.kind === 'station') {
    const count = countOwnedOfKind(state, owner, 'station');
    rent = STATION_RENT[count] ?? 0;
  } else if (s.kind === 'utility') {
    const count = countOwnedOfKind(state, owner, 'utility');
    rent = opts.diceTotal * (UTILITY_MULTIPLIER[count] ?? 0);
  } else {
    return 0;
  }
  if (opts.doubleRent) rent *= 2;
  if (isRushHour(state, opts.now)) rent = ceil5(rent * 1.5);
  return rent;
}

export function countOwnedOfKind(
  state: GameState,
  owner: PlayerId,
  kind: 'station' | 'utility',
): number {
  return OWNABLE_INDICES.filter(
    (i) => spaceAt(i).kind === kind && getProperty(state, i).owner === owner,
  ).length;
}

export function mortgageValue(space: number): number {
  const s = spaceAt(space);
  if (!isOwnable(s)) return 0;
  return Math.floor(s.price / 2);
}

export function unmortgageCost(space: number): number {
  return Math.ceil(mortgageValue(space) * 1.1);
}

export function transferFee(space: number): number {
  return Math.ceil(mortgageValue(space) * 0.1);
}

/** Wealth used by the 75-minute backstop: cash + property value + buildings at cost. */
export function netWorth(state: GameState, id: PlayerId): number {
  const player = findPlayer(state, id);
  if (!player) return 0;
  let total = player.cash;
  for (const i of OWNABLE_INDICES) {
    const prop = getProperty(state, i);
    if (prop.owner !== id) continue;
    const s = spaceAt(i);
    if (!isOwnable(s)) continue;
    total += prop.mortgaged ? mortgageValue(i) : s.price;
    if (s.kind === 'street') total += (prop.houses + (prop.landmark ? 5 : 0)) * s.houseCost;
  }
  return total;
}

export function propertiesOf(state: GameState, id: PlayerId): number[] {
  return OWNABLE_INDICES.filter((i) => getProperty(state, i).owner === id);
}

export { BOARD };
