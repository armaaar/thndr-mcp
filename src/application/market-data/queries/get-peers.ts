import { z } from 'zod';
import type { Instrument, Quote } from '../../../domain/market-data/instrument';
import { MARKET_PROFILES, type Market, parseMarket } from '../../../domain/shared-kernel/market';
import { marketInput, symbolInput } from '../../inputs';
import { type InputOf, Query } from '../../use-case';
import type { MarketDataDependencies } from '../dependencies';
import { LATEST_PRICE_NOTE, quoteInstruments } from '../services/instrument-quotes';
import { dataMarket, snapshotMarket } from '../services/snapshot-market';

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
  /** Present outside Egypt: why `sameSector` is empty and which quote fields are known. */
  notes?: string[];
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
 * same sector in the market snapshot, both joined with live quotes. Index rows are never peers. Markets without the
 * whole-market snapshot (all but Egypt) have no same-sector list; their similar stocks carry the bulk latest price.
 */
export class GetPeers extends Query<typeof input, Peers> {
  readonly name = 'get_peers';
  readonly title = 'Peers';
  readonly description =
    'All markets: Thndr\'s "similar stocks" for one stock, each with last price and change %. Egypt also gives the ' +
    'largest other instruments of the same sector (by market cap) and, for every peer, traded value, market cap, ' +
    'P/E and dividend yield; elsewhere `sameSector` is empty (no whole-market snapshot) and those fields are null.';
  readonly context = 'market-data';
  readonly input = input;

  constructor(private readonly deps: MarketDataDependencies) {
    super();
  }

  async execute(params: InputOf<typeof input>): Promise<Peers> {
    const market = parseMarket(params.market);
    const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
    const instrument = await this.deps.resolver.resolve(params.symbol, market);
    // The instrument's own market (a simulator search answers with Egyptian and US listings).
    const home = snapshotMarket(instrument.market);
    if (!home) return this.withoutSnapshot(market, instrument, limit);
    const [quotes, similar] = await Promise.all([
      this.deps.quotes.get(home),
      this.deps.repository.getSimilarInstruments(instrument.id, home, limit),
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

  /** Similar stocks with their bulk latest prices; no same-sector list without the market snapshot. */
  private async withoutSnapshot(market: Market, instrument: Instrument, limit: number): Promise<Peers> {
    const similar = (
      await this.deps.repository.getSimilarInstruments(instrument.id, dataMarket(instrument.market), limit)
    )
      .filter((peer) => !peer.id.equals(instrument.id))
      .slice(0, limit);
    const quotes = similar.length > 0 ? await quoteInstruments(this.deps, similar) : new Map();
    return {
      market,
      ticker: instrument.ticker.value,
      sector: instrument.sector,
      similar: similar.map((peer) =>
        toPeer(quotes.get(peer.id.value)?.quote, {
          ticker: peer.ticker.value,
          name: peer.name,
          sector: peer.sector,
        }),
      ),
      sameSector: [],
      sameSectorTotal: 0,
      notes: [
        `No same-sector list for the ${MARKET_PROFILES[instrument.market].name} market: Thndr offers the ` +
          'whole-market snapshot it needs only for Egypt.',
        LATEST_PRICE_NOTE,
      ],
    };
  }
}
