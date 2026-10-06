import type { Market } from '../shared-kernel/market';
import type { Currency } from '../shared-kernel/money';
import type { Instrument } from './instrument';

/**
 * Discovery data the Thndr mobile app shows (ADR 0021, docs/api/mobile-app.md §1.3, §2.7, §2.8, §4.B): which markets
 * the user may use, top movers, trending instruments, tags (themes) and dividends.
 */

/** A market Thndr lets the user see, and whether it is restricted for them. */
export interface VisibleMarket {
  readonly market: Market;
  readonly restricted: boolean;
  /** Thndr's reason code, e.g. `USER_UNDER_ELIGIBLE_AGE` or `NOT_THNDR_FORTUNE`. */
  readonly restrictionReason: string | null;
}

/** The markets Thndr lists for the user (`visible-markets`). */
export interface MarketAccess {
  readonly markets: readonly VisibleMarket[];
  /** The market Thndr opens by default, when it is one thndr-mcp serves. */
  readonly defaultMarket: Market | null;
  /** Names of listed markets thndr-mcp does not serve (e.g. a new exchange), as Thndr names them. */
  readonly otherMarkets: readonly string[];
}

/** An instrument with the price figures Thndr attaches to a list entry (its feed), when present. */
export interface ListedInstrument {
  readonly instrument: Instrument;
  readonly price: number | null;
  readonly previousClose: number | null;
  /** Today's change, in percent. */
  readonly changePercent: number | null;
}

export const MOVER_TYPES = ['gainers', 'losers'] as const;
export type MoverType = (typeof MOVER_TYPES)[number];

export const MOVER_PERIODS = ['1D', '1W', '1M', '6M', '1Y'] as const;
export type MoverPeriod = (typeof MOVER_PERIODS)[number];

/** An instrument ranked by its return over a period. */
export interface Mover extends ListedInstrument {
  /** Return over the period, in percent. */
  readonly returnPercent: number | null;
}

export interface MoverList {
  readonly movers: readonly Mover[];
  /** When Thndr last computed the ranking, when it says. */
  readonly updatedAt: Date | null;
}

/** A Thndr tag (the app calls them themes): a curated group of instruments such as "Sharia" or "Gold Funds". */
export interface Tag {
  readonly id: string;
  readonly slug: string | null;
  readonly name: string;
  readonly about: string | null;
  /** Instruments in the tag, as Thndr counts them for the market. */
  readonly instrumentCount: number | null;
  readonly featured: boolean;
}

export interface TagPage {
  readonly tag: Tag;
  readonly instruments: readonly ListedInstrument[];
}

/**
 * Finds a tag by id, slug or name (case and spacing ignored); null when none matches. An exact match wins over a
 * partial one, and a partial name match is accepted only when it is unique.
 */
export function findTag(tags: readonly Tag[], query: string): Tag | null {
  const wanted = normalize(query);
  if (!wanted) return null;
  const exact = tags.find(
    (tag) =>
      tag.id === query.trim() || normalize(tag.slug ?? '') === wanted || normalize(tag.name) === wanted,
  );
  if (exact) return exact;
  const partial = tags.filter((tag) => normalize(tag.name).includes(wanted));
  return partial.length === 1 ? (partial[0] as Tag) : null;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/[\s_-]+/g, ' ')
    .toLowerCase();
}

export const DIVIDEND_TYPES = ['CASH', 'STOCK', 'UNKNOWN'] as const;
export type DividendType = (typeof DIVIDEND_TYPES)[number];

export const DIVIDEND_STATUSES = ['UPCOMING', 'ONGOING', 'PAST', 'UNKNOWN'] as const;
export type DividendStatus = (typeof DIVIDEND_STATUSES)[number];

/** One payment date of a dividend, with the part of the ratio paid then. */
export interface DividendDistribution {
  /** ISO date (YYYY-MM-DD). */
  readonly date: string | null;
  readonly ratio: number | null;
}

/**
 * A dividend Thndr records for an instrument. `ratio` is cash per share (in `currency`) for a cash dividend and bonus
 * shares per share held for a stock dividend (0.1 = one new share for every ten).
 */
export interface Dividend {
  readonly id: string;
  readonly type: DividendType;
  readonly status: DividendStatus;
  /** ISO date (YYYY-MM-DD): shareholders on record that day are entitled. */
  readonly recordDate: string | null;
  readonly ratio: number | null;
  readonly currency: Currency | null;
  /** Thndr's frequency, e.g. `ONE_TIME`. */
  readonly frequency: string | null;
  readonly couponNumber: string | null;
  readonly distributions: readonly DividendDistribution[];
}

export interface DividendPage {
  readonly dividends: readonly Dividend[];
  /** Dividends across all pages, as Thndr counts them. */
  readonly total: number | null;
}
