/** Board data for Hometown, as approved in rulebook draft 1 (31 Oct 2026). Amounts are in kr. */

export type ColorGroup =
  | 'brown'
  | 'lightBlue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkBlue';

export interface StreetSpace {
  kind: 'street';
  name: string;
  group: ColorGroup;
  price: number;
  /** Rent with: none, full group (unbuilt), 1, 2, 3 houses, landmark. */
  rent: readonly [number, number, number, number, number, number];
  houseCost: number;
}

export type Space =
  | StreetSpace
  | { kind: 'station'; name: string; price: number }
  | { kind: 'utility'; name: string; price: number }
  | { kind: 'start'; name: string }
  | { kind: 'jail'; name: string }
  | { kind: 'fika'; name: string }
  | { kind: 'ohopp'; name: string }
  | { kind: 'minigame'; name: string }
  | { kind: 'card'; name: string }
  | { kind: 'inspector'; name: string }
  | { kind: 'tax'; name: string; tax: 'percent' | 'flat' };

const street = (
  name: string,
  group: ColorGroup,
  price: number,
  rent: StreetSpace['rent'],
  houseCost: number,
): StreetSpace => ({ kind: 'street', name, group, price, rent, houseCost });

export const BOARD: readonly Space[] = [
  { kind: 'start', name: 'START' },
  street('Liljeholmen', 'brown', 80, [5, 10, 35, 100, 210, 300], 75),
  { kind: 'minigame', name: 'Minispel' },
  street('Hammarby sjöstad', 'brown', 100, [10, 20, 40, 120, 260, 380], 75),
  { kind: 'station', name: 'T-Gullmarsplan', price: 200 },
  street('Aspudden', 'lightBlue', 120, [10, 20, 50, 150, 310, 460], 75),
  { kind: 'card', name: 'Händelse' },
  street('Midsommarkransen', 'lightBlue', 120, [10, 20, 50, 150, 310, 460], 75),
  street('Hornstull', 'lightBlue', 140, [10, 20, 60, 180, 360, 530], 75),
  { kind: 'tax', name: 'Skatteverket', tax: 'percent' },
  { kind: 'jail', name: 'ARRESTEN' },
  street('Fridhemsplan', 'pink', 170, [15, 30, 80, 210, 440, 650], 125),
  street('Rålambshov', 'pink', 170, [15, 30, 80, 210, 440, 650], 125),
  { kind: 'utility', name: 'Elverket', price: 160 },
  street('Kungsholmen', 'pink', 190, [15, 30, 90, 240, 490, 720], 125),
  { kind: 'minigame', name: 'Minispel' },
  street('Sankt Eriksplan', 'orange', 220, [20, 40, 100, 280, 570, 840], 125),
  { kind: 'station', name: 'T-Odenplan', price: 200 },
  street('Vasastan', 'orange', 220, [20, 40, 100, 280, 570, 840], 125),
  street('Tegnérlunden', 'orange', 240, [20, 40, 110, 300, 620, 910], 125),
  { kind: 'fika', name: 'FIKA' },
  street('Mariatorget', 'red', 270, [20, 40, 120, 340, 700, 1030], 175),
  { kind: 'card', name: 'Händelse' },
  street('Nytorget', 'red', 270, [20, 40, 120, 340, 700, 1030], 175),
  street('Slussen', 'red', 290, [25, 50, 130, 360, 750, 1100], 175),
  { kind: 'station', name: 'T-Centralen', price: 200 },
  street('Skeppsholmen', 'yellow', 320, [25, 50, 140, 400, 830, 1220], 175),
  { kind: 'utility', name: 'Vattenverket', price: 160 },
  street('Stortorget', 'yellow', 320, [25, 50, 140, 400, 830, 1220], 175),
  street('Gamla stan', 'yellow', 340, [25, 50, 150, 420, 880, 1290], 175),
  { kind: 'ohopp', name: 'Ö-HOPP!' },
  street('Hötorget', 'green', 370, [30, 60, 170, 460, 960, 1410], 225),
  street('Sergels torg', 'green', 370, [30, 60, 170, 460, 960, 1410], 225),
  { kind: 'minigame', name: 'Minispel' },
  street('Kungsträdgården', 'green', 390, [30, 60, 180, 490, 1010, 1480], 225),
  { kind: 'inspector', name: 'Kontrollant!' },
  { kind: 'station', name: 'T-Ropsten', price: 200 },
  street('Östermalm', 'darkBlue', 440, [35, 70, 200, 550, 1140, 1670], 225),
  { kind: 'tax', name: 'Trängselskatt', tax: 'flat' },
  street('Djurgården', 'darkBlue', 500, [40, 80, 220, 620, 1300, 1900], 225),
];

export const BOARD_SIZE = BOARD.length;
export const JAIL_INDEX = BOARD.findIndex((s) => s.kind === 'jail');
export const STATION_RENT = [0, 25, 50, 100, 200] as const;
export const UTILITY_MULTIPLIER = [0, 5, 12] as const;
export const TRANGSELSKATT = 150;
export const SKATTEVERKET_RATE = 0.1;
export const SKATTEVERKET_MIN = 100;

export type OwnableSpace = Extract<Space, { price: number }>;

export function spaceAt(index: number): Space {
  const space = BOARD[index];
  if (!space) throw new Error(`No space at index ${index}`);
  return space;
}

export function isOwnable(space: Space): space is OwnableSpace {
  return space.kind === 'street' || space.kind === 'station' || space.kind === 'utility';
}

export const OWNABLE_INDICES: readonly number[] = BOARD.flatMap((s, i) =>
  isOwnable(s) ? [i] : [],
);

const groupIndex = new Map<ColorGroup, number[]>();
BOARD.forEach((s, i) => {
  if (s.kind === 'street') groupIndex.set(s.group, [...(groupIndex.get(s.group) ?? []), i]);
});

/** Indices of every street in a colour group. */
export function groupMembers(group: ColorGroup): readonly number[] {
  return groupIndex.get(group) ?? [];
}

/** Index of the next space of a kind, searching forward (wrapping) from `from` (exclusive). */
export function nextSpaceOfKind(from: number, kind: Space['kind']): number {
  for (let step = 1; step <= BOARD_SIZE; step++) {
    const i = (from + step) % BOARD_SIZE;
    if (spaceAt(i).kind === kind) return i;
  }
  throw new Error(`No space of kind ${kind}`);
}
