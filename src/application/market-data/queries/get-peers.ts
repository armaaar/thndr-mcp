import { z } from 'zod';
import type { Quote } from '../../../domain/market-data/instrument';
import { type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';

const input = {
  symbol: symbolInput,
  market: marketInput,
  limit: z.number().int().min(1).max(20).default(5).describe('Maximum peers per list'),
};

export interface Peer {
  ticker: string;
  name: string | null;
  sector: string | null;
  last: number | null;
  changePercent: number | null;
  value: number | null;
  marketCap: number | null;
  peRatio: number | null;
  dividendYieldPercent: number | null;
}

export interface Peers {
  market: Market;
  ticker: string;
  sector: string | null;
  /** Thndr's "similar stocks" for the instrument, in Thndr's order. */
  similar: Peer[];
  /** Other instruments of the same sector in the market snapshot, largest market cap first. */
  sameSector: Peer[];
  /** Number of other instruments in the sector (before the limit). */
  sameSectorTotal: number;
}

function sameText(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A peer from its marketwatch quote, or from Thndr's listing alone when it is absent from the snapshot. */
function toPeer(
  quote: Quote | undefined,
  listing: { ticker: string; name: string | null; sector: string | null },
): Peer {
  if (!quote) {
    return {
      ...listing,
      last: null,
      changePercent: null,
      value: null,
      marketCap: null,
      peRatio: null,
      dividendYieldPercent: null,
    };
  }
  return {
    ticker: quote.ticker.value,
    name: quote.name,
    sector: quote.sector,
    last: quote.last,
    changePercent: quote.changePercent,
    value: quote.value,
    marketCap: quote.marketCap,
    peRatio: quote.peRatio,
    dividendYieldPercent: quote.dividendYieldPercent,
  };
}

/** Largest market cap first; unknown caps last. */
function byCapDesc(a: Quote, b: Quote): number {
  if (a.marketCap === b.marketCap) return 0;
  if (a.marketCap === null) return 1;
  if (b.marketCap === null) return -1;
  return b.marketCap - a.marketCap;
}

/**
 * Peers of an instrument: Thndr's "similar stocks" (ThndrX's stock page widget) and the largest instruments of the
 * same sector in the market snapshot, both joined with live quotes. Index rows are never peers.
 */
export class GetPeers extends Query<typeof input, Peers> {
  readonly name = 'get_peers';
  readonly title = 'Peers';
  readonly description =
    'Comparable instruments for one stock: Thndr\'s "similar stocks" and the largest other instruments of the same ' +
    'sector (by market cap), each with last price, change %, traded value, market cap, P/E and dividend yield.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Peers> {
    const market = parseMarket(params.market);
    const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
    const instrument = await this.deps.resolver.resolve(params.symbol, market);
    const [quotes, similar] = await Promise.all([
      this.deps.quotes.get(market),
      this.deps.repository.getSimilarInstruments(instrument.id, market, limit),
    ]);
    const byId = new Map(quotes.map((q) => [q.instrumentId.value, q]));
    const own = byId.get(instrument.id.value);
    const sector = own?.sector ?? instrument.sector;
    const sameSector = quotes
      .filter(
        (q) => q.board !== 'INDX' && !q.instrumentId.equals(instrument.id) && sameText(q.sector, sector),
      )
      .sort((a, b) => byCapDesc(a, b));
    return {
      market,
      ticker: instrument.ticker.value,
      sector,
      similar: similar
        .filter((peer) => !peer.id.equals(instrument.id))
        .slice(0, limit)
        .map((peer) =>
          toPeer(byId.get(peer.id.value), {
            ticker: peer.ticker.value,
            name: peer.name,
            sector: peer.sector,
          }),
        ),
      sameSector: sameSector
        .slice(0, limit)
        .map((q) => toPeer(q, { ticker: q.ticker.value, name: null, sector: null })),
      sameSectorTotal: sameSector.length,
    };
  }
}
