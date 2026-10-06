import { describe, expect, it } from 'vitest';
import {
  createWatchlist,
  uniqueAssetIds,
  WATCHLIST_NAME_MAX_LENGTH,
  WatchlistName,
} from '../../../src/domain/engagement/watchlist';
import { AssetId } from '../../../src/domain/market-data/asset-id';
import { ValidationError } from '../../../src/domain/shared-kernel/errors';

const A = AssetId.of('1923d036-45ad-480b-8c6b-1d1296862f6e');
const B = AssetId.of('b0a4c53e-b12f-4e93-b94b-759b8eeaef14');

describe('WatchlistName', () => {
  it('trims and keeps the value', () => {
    const name = WatchlistName.of('  Banks  ');
    expect(name.value).toBe('Banks');
    expect(name.toString()).toBe('Banks');
    expect(JSON.stringify({ name })).toBe('{"name":"Banks"}');
    expect(Object.isFrozen(name)).toBe(true);
    expect(name.equals(WatchlistName.of('Banks'))).toBe(true);
    expect(name.equals(WatchlistName.of('Tech'))).toBe(false);
  });

  it('accepts exactly 50 characters, counting emoji as one', () => {
    expect(WatchlistName.of('x'.repeat(WATCHLIST_NAME_MAX_LENGTH)).value).toHaveLength(50);
    expect(WatchlistName.of(`${'x'.repeat(49)}🚀`).value).toContain('🚀');
  });

  it.each([
    ['', 'must not be empty'],
    ['   ', 'must not be empty'],
    [undefined as unknown as string, 'must not be empty'],
    ['x'.repeat(51), 'at most 50'],
  ])('rejects %j', (raw, message) => {
    expect(() => WatchlistName.of(raw)).toThrow(ValidationError);
    expect(() => WatchlistName.of(raw)).toThrow(message);
  });
});

describe('createWatchlist', () => {
  it('freezes, trims the id, dedupes ids and defaults color/icon to null', () => {
    const w = createWatchlist({ id: ' wl ', name: 'Banks', instrumentIds: [A, B, A] });
    expect(w).toEqual({ id: 'wl', name: 'Banks', instrumentIds: [A, B], color: null, icon: null });
    expect(Object.isFrozen(w)).toBe(true);
    expect(Object.isFrozen(w.instrumentIds)).toBe(true);
  });

  it('keeps color and icon', () => {
    const w = createWatchlist({ id: '1', name: 'x', instrumentIds: [], color: 'color_4', icon: 'thndr' });
    expect(w).toMatchObject({ color: 'color_4', icon: 'thndr' });
  });

  it.each(['', '  ', 5 as unknown as string])('rejects id %j', (id) => {
    expect(() => createWatchlist({ id, name: 'x', instrumentIds: [] })).toThrow(
      'Watchlist id must not be empty',
    );
  });
});

describe('uniqueAssetIds', () => {
  it('keeps first occurrences in order', () => {
    expect(uniqueAssetIds([B, A, B, A])).toEqual([B, A]);
    expect(uniqueAssetIds([])).toEqual([]);
  });
});
