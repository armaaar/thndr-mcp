import type { AssetId } from '../market-data/asset-id.js';
import { ValidationError } from '../shared-kernel/errors.js';

export const WATCHLIST_NAME_MAX_LENGTH = 50;

/** The user-facing name of a custom watchlist: trimmed, 1–50 characters. */
export class WatchlistName {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): WatchlistName {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length === 0) throw new ValidationError('Watchlist name must not be empty');
    if ([...value].length > WATCHLIST_NAME_MAX_LENGTH) {
      throw new ValidationError(`Watchlist name must be at most ${WATCHLIST_NAME_MAX_LENGTH} characters`);
    }
    return new WatchlistName(value);
  }

  equals(other: WatchlistName): boolean {
    return other.value === this.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/**
 * A user's custom watchlist (aggregate root). `instrumentIds` keeps Thndr's order and contains no duplicates.
 * `name` is the upstream value as stored by Thndr (it may be empty when a payload omits it).
 */
export interface Watchlist {
  readonly id: string;
  readonly name: string;
  readonly instrumentIds: readonly AssetId[];
  /** ThndrX palette key such as `color_4`. */
  readonly color: string | null;
  /** ThndrX icon key such as `thndr`. */
  readonly icon: string | null;
}

export function createWatchlist(input: {
  id: string;
  name: string;
  instrumentIds: readonly AssetId[];
  color?: string | null;
  icon?: string | null;
}): Watchlist {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id.length === 0) throw new ValidationError('Watchlist id must not be empty');
  return Object.freeze({
    id,
    name: input.name,
    instrumentIds: Object.freeze(uniqueAssetIds(input.instrumentIds)),
    color: input.color ?? null,
    icon: input.icon ?? null,
  });
}

/** Removes duplicate asset ids, keeping the first occurrence (and therefore the order). */
export function uniqueAssetIds(ids: readonly AssetId[]): AssetId[] {
  const seen = new Set<string>();
  const out: AssetId[] = [];
  for (const id of ids) {
    if (seen.has(id.value)) continue;
    seen.add(id.value);
    out.push(id);
  }
  return out;
}
