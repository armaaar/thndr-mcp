import type { Instrument, Quote } from '../../../domain/market-data/instrument';
import { quoteFromLatestPrice } from '../../../domain/market-data/latest-price';
import type { MarketDataRepository } from '../../../domain/market-data/repository';
import type { Market } from '../../../domain/shared-kernel/market';
import { FeatureDisabledError, UpstreamError } from '../../errors';
import type { MarketQuotesCache } from './market-quotes-cache';
import { snapshotMarket } from './snapshot-market';

/** Where a quote came from: Egypt's full marketwatch row, or the thinner bulk latest price (every market). */
export type QuoteSource = 'marketwatch' | 'latest-price';

export interface InstrumentQuote {
  readonly quote: Quote;
  readonly source: QuoteSource;
}

/**
 * Quotes for instruments of any market (ADR 0021), keyed by asset id. Instruments of a market with a whole-market
 * snapshot ({@link snapshotMarket}: Egypt, and the simulator through Egypt's) take their marketwatch row; the others — and any Egyptian instrument missing from the snapshot — take
 * Thndr's bulk latest price, in one call. Instruments without either are absent from the map.
 */
export async function quoteInstruments(
  deps: { repository: MarketDataRepository; quotes: MarketQuotesCache },
  instruments: readonly Instrument[],
): Promise<Map<string, InstrumentQuote>> {
  const found = new Map<string, InstrumentQuote>();
  const bySnapshot = new Map<Market, Instrument[]>();
  for (const instrument of instruments) {
    const snapshot = snapshotMarket(instrument.market);
    if (snapshot) bySnapshot.set(snapshot, [...(bySnapshot.get(snapshot) ?? []), instrument]);
  }
  for (const [market, members] of bySnapshot) {
    const rows = new Map((await deps.quotes.get(market)).map((q) => [q.instrumentId.value, q]));
    for (const instrument of members) {
      const quote = rows.get(instrument.id.value);
      if (quote) found.set(instrument.id.value, { quote, source: 'marketwatch' });
    }
  }
  const rest = instruments.filter((i) => !found.has(i.id.value));
  if (rest.length === 0) return found;
  let latest: Awaited<ReturnType<MarketDataRepository['getLatestPrices']>>;
  try {
    latest = await deps.repository.getLatestPrices(rest.map((i) => i.id));
  } catch (error) {
    // Only snapshot rows were missing: the bulk price was a bonus, so they stay missing instead of failing the call.
    const fallbackOnly = rest.every((i) => snapshotMarket(i.market) !== null);
    if (fallbackOnly && (error instanceof UpstreamError || error instanceof FeatureDisabledError))
      return found;
    throw error;
  }
  const prices = new Map(latest.map((p) => [p.instrumentId.value, p]));
  for (const instrument of rest) {
    const price = prices.get(instrument.id.value);
    if (price)
      found.set(instrument.id.value, {
        quote: quoteFromLatestPrice(instrument, price),
        source: 'latest-price',
      });
  }
  return found;
}

/** Explains the null fields of quotes built from the bulk latest price. */
export const LATEST_PRICE_NOTE =
  'Quotes outside Egypt (and Egyptian instruments missing from the marketwatch) come from Thndr’s bulk latest ' +
  'price: only last, open, previous close, change and change % ' +
  '(from the previous close), bid/ask when Thndr has them and the price time (lastTradeAt) are known; the other ' +
  'fields are null.';
