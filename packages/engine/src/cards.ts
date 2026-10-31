import type { ItemKind } from './types.js';

/** Händelse cards, as approved in rulebook draft 1. Effects are applied in engine.ts. */
export type CardEffect =
  | { kind: 'collect'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'everyoneCollects'; amount: number }
  | { kind: 'othersPayYou'; amount: number }
  | { kind: 'repairs'; perHouse: number; perLandmark: number }
  | { kind: 'moveBack'; spaces: number }
  | { kind: 'nextMinigame' }
  | { kind: 'nextStationDoubleRent' }
  | { kind: 'moveTo'; space: number }
  | { kind: 'goToJail' }
  | { kind: 'gainItem'; item: ItemKind };

export interface Card {
  title: string;
  text: string;
  effect: CardEffect;
}

export const CARDS: readonly Card[] = [
  { title: 'Swish från mormor', text: 'Collect 100 kr.', effect: { kind: 'collect', amount: 100 } },
  {
    title: 'Kanelbullens dag',
    text: 'Every player collects 50 kr.',
    effect: { kind: 'everyoneCollects', amount: 50 },
  },
  {
    title: 'Midsommarfest at yours',
    text: 'Every other player pays you 25 kr.',
    effect: { kind: 'othersPayYou', amount: 25 },
  },
  { title: 'Julbord', text: 'Pay 100 kr.', effect: { kind: 'pay', amount: 100 } },
  {
    title: 'Hyreshöjning',
    text: 'Pay 25 kr per house and 100 kr per landmark you own.',
    effect: { kind: 'repairs', perHouse: 25, perLandmark: 100 },
  },
  {
    title: 'Snöplogen kom förbi',
    text: 'Move back 3 spaces.',
    effect: { kind: 'moveBack', spaces: 3 },
  },
  {
    title: 'Luciatåget',
    text: 'Move forward to the next Minispel space.',
    effect: { kind: 'nextMinigame' },
  },
  {
    title: 'Ta tunnelbanan',
    text: 'Move to the next T-station. If it is owned, pay double rent.',
    effect: { kind: 'nextStationDoubleRent' },
  },
  {
    title: 'Valborg på Djurgården',
    text: 'Move to Djurgården.',
    effect: { kind: 'moveTo', space: 39 },
  },
  {
    title: 'Tillbaka till START',
    text: 'Move to START and collect 400 kr.',
    effect: { kind: 'moveTo', space: 0 },
  },
  { title: 'Plankade på bussen', text: 'Go to Arresten.', effect: { kind: 'goToJail' } },
  {
    title: 'Allemansrätten',
    text: 'Gain the Hyresfrihet item.',
    effect: { kind: 'gainItem', item: 'hyresfrihet' },
  },
  {
    title: 'Advokat i familjen',
    text: 'Gain the Advokat item.',
    effect: { kind: 'gainItem', item: 'advokat' },
  },
  {
    title: 'Gratis pendeltåg',
    text: 'Gain the SL-kort item.',
    effect: { kind: 'gainItem', item: 'slkort' },
  },
  {
    title: 'Vann på Bingolotto',
    text: 'Collect 200 kr.',
    effect: { kind: 'collect', amount: 200 },
  },
  { title: 'Glömt mobilladdaren', text: 'Pay 50 kr.', effect: { kind: 'pay', amount: 50 } },
];

export const ITEMS: readonly ItemKind[] = [
  'dubbeltarning',
  'slkort',
  'hyresfrihet',
  'advokat',
  'snoplog',
  'byggrabatt',
];

export const ITEM_NAMES: Record<ItemKind, string> = {
  dubbeltarning: 'Dubbeltärning',
  slkort: 'SL-kort',
  hyresfrihet: 'Hyresfrihet',
  advokat: 'Advokat',
  snoplog: 'Snöplog',
  byggrabatt: 'Byggrabatt',
};
