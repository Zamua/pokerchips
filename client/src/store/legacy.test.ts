import { describe, expect, it } from 'vitest';
import { mergeRecent, parseLegacy, withoutRoom } from './legacy.js';

const stored = JSON.stringify([
  { roomId: 'abcd1234', playerName: 'Maya', lastVisited: 300 },
  { roomId: 'EFGH5678', playerName: '  Big   Ben!! ', lastVisited: 200 },
  { roomId: 'abcd1234', playerName: 'Again', lastVisited: 100 },
  { roomId: 'short', playerName: 'Nope', lastVisited: 100 },
  { roomId: 'ijkl9012', playerName: '***', lastVisited: 'later' },
  null,
]);

describe('adopting version 2 recent rooms', () => {
  it('maps each readable room to a table code and a valid name', () => {
    expect(parseLegacy(stored)).toEqual([
      { code: 'abcd1234', name: 'Maya', openedAt: 300 },
      { code: 'efgh5678', name: 'Big Ben', openedAt: 200 },
      { code: 'ijkl9012', name: '', openedAt: 0 },
    ]);
  });

  it('reads nothing from a missing or broken value', () => {
    expect(parseLegacy(null)).toEqual([]);
    expect(parseLegacy('{')).toEqual([]);
    expect(parseLegacy('{"roomId":"abcd1234"}')).toEqual([]);
  });

  it('lists them with this device\'s seats, newest first, hiding a room it already has a seat at', () => {
    const seats = [{ code: 'abcd1234', name: 'Maya', seatKey: 'k', openedAt: 250 }];
    const merged = mergeRecent(seats, parseLegacy(stored));
    expect(merged.map((i) => `${i.kind}:${i.table.code}`)).toEqual(['seat:abcd1234', 'legacy:efgh5678', 'legacy:ijkl9012']);
  });

  it('drops one room and keeps the rest as stored', () => {
    const left = JSON.parse(withoutRoom(stored, 'efgh5678')!) as { roomId: string }[];
    expect(left.map((r) => r?.roomId)).toEqual(['abcd1234', 'abcd1234', 'short', 'ijkl9012', undefined]);
    expect(withoutRoom(JSON.stringify([{ roomId: 'abcd1234' }]), 'abcd1234')).toBeNull();
  });
});
