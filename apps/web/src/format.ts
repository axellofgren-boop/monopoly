import { ITEM_NAMES, spaceAt } from '@hometown/engine';
import type { GameEvent, PlayerId, PublicState } from '@hometown/engine';
import { kr } from './dom.js';

export function nameOf(state: PublicState, id: PlayerId | 'bank' | null): string {
  if (id === 'bank') return 'the bank';
  if (!id) return 'nobody';
  return state.players.find((p) => p.id === id)?.name ?? 'someone';
}

/** One readable log line per event, or null for events not worth a line. */
export function describeEvent(state: PublicState, e: GameEvent): string | null {
  const n = (id: PlayerId | 'bank' | null) => nameOf(state, id);
  switch (e.type) {
    case 'rolled':
      return `${n(e.player)} rolled ${e.dice.join(' + ')}`;
    case 'moved':
      return `${n(e.player)} moved to ${spaceAt(e.to).name}`;
    case 'paid':
      // Purchases already get their own line.
      if (/^bought /.test(e.reason)) return null;
      return e.from === 'bank' || e.to === 'bank' || e.reason === 'trade'
        ? `${n(e.from)} paid ${n(e.to)} ${kr(e.amount)} (${e.reason})`
        : `${n(e.from)} paid ${n(e.to)} ${kr(e.amount)} ${e.reason}`;
    case 'bought':
      return `${n(e.player)} bought ${spaceAt(e.space).name} for ${kr(e.price)}`;
    case 'declinedBuy':
      return `${n(e.player)} didn't buy ${spaceAt(e.space).name}`;
    case 'card':
      return `Händelse for ${n(e.player)}: ${e.card}`;
    case 'item':
      return e.gained
        ? `${n(e.player)} got ${ITEM_NAMES[e.item]}`
        : `${n(e.player)} used ${ITEM_NAMES[e.item]}`;
    case 'jailed':
      return `${n(e.player)} went to Arresten`;
    case 'released':
      return `${n(e.player)} left Arresten`;
    case 'built':
      return `${n(e.player)} built a ${e.landmark ? 'landmark' : 'house'} on ${spaceAt(e.space).name}`;
    case 'sold':
      return `${n(e.player)} sold a building on ${spaceAt(e.space).name}`;
    case 'mortgaged':
      return `${n(e.player)} ${e.unmortgaged ? 'lifted the mortgage on' : 'mortgaged'} ${spaceAt(e.space).name}`;
    case 'tradeProposed':
      return `${n(e.trade.from)} offered ${n(e.trade.to)} a trade`;
    case 'tradeResolved':
      return `Trade ${e.outcome}`;
    case 'minigameStarted':
      return e.reason === 'roundFinal' ? 'Round final minigame!' : 'Minigame!';
    case 'minigameResult':
      return `Minigame winner: ${(e.ranking[0] ?? []).map(n).join(' & ')}`;
    case 'crisis':
      return `${n(e.player)} owes ${kr(e.amount)} and must raise money`;
    case 'bankrupt':
      return `${n(e.player)} went bankrupt`;
    case 'turnStarted':
      return null;
    case 'rushHour':
      return 'Rush hour! Rents are up 50%.';
    case 'gameOver':
      return `Game over. ${e.winners.map(n).join(' & ')} won!`;
  }
}
