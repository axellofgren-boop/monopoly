import { randomInt } from 'node:crypto';
import { ROOM_CODE_LENGTH } from '@hometown/protocol';
import { Room } from './room.js';

/** Letters only, without look-alikes (I, L, O), so codes are easy to read out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
/** Rooms with nobody connected are removed after this long. */
const IDLE_ROOM_MS = 30 * 60_000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  create(now: number): Room {
    let code: string;
    do {
      code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, randomInt(2 ** 31), now);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  tick(now: number): void {
    for (const [code, room] of this.rooms) {
      if (room.connectedCount === 0 && now - room.lastActivity > IDLE_ROOM_MS) {
        this.rooms.delete(code);
        continue;
      }
      room.tick(now);
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
