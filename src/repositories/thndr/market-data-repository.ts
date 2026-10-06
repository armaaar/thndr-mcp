import { NotFoundError, UpstreamError } from '../../application/errors';
import type {
  AssetDto,
  AssetSearchResponseDto,
  CandlesResponseDto,
  MarketDepthResponseDto,
  MarketHoursDto,
  MarketIndicatorsResponseDto,
  MarketStatusDto,
  MarketwatchResponseDto,
  RecommendationsResponseDto,
  ScreenerDto,
  ScreenersResponseDto,
  TradesBookResponseDto,
} from '../../data-sources/thndr/dto/market-data';
import type { ThndrHttpClient } from '../../data-sources/thndr/http-client';
import { assertNoKrakendError } from '../../data-sources/thndr/krakend';
import { parseTimestamp } from '../../data-sources/thndr/wire';
import type { Candle, CandleResolution } from '../../domain/market-data/candle';
import type { Instrument, Quote } from '../../domain/market-data/instrument';
import type { MarketSession, OrderBook, TapeTrade } from '../../domain/market-data/order-book';
import type { MarketDataRepository } from '../../domain/market-data/repository';
import type { Screener } from '../../domain/market-data/screener';
import type { AssetId } from '../../domain/shared-kernel/asset-id';
import type { Market } from '../../domain/shared-kernel/market';
import { accountMarket, instrumentMarket, statusExchange } from './markets';
import {
  indicatorToQuote,
  mapRows,
  toCandle,
  toConstituentIds,
  toInstrument,
  toOrderBook,
  toQuote,
  toTapeTrade,
  WIRE_RESOLUTION,
} from './translators/market-data';
import { toScreener } from './translators/screener';

const FEED = { include_feed: true, feed_detail: true } as const;

/**
 * Adapter for Thndr's market-data endpoints (docs/api/market-data.md).
 * `api` targets https://prod.thndr.app, `krakend` targets https://prod.thndr.app/krakend-thndr-x; every krakend
 * response goes through {@link assertNoKrakendError}.
 */
export class ThndrMarketDataRepository implements MarketDataRepository {
  constructor(
    private readonly api: ThndrHttpClient,
    private readonly krakend: ThndrHttpClient,
  ) {}

  async searchInstruments(query: string, market: Market): Promise<Instrument[]> {
    const data = await this.api.get<AssetSearchResponseDto>('/assets-service/assets/search', {
      query: { query, market: instrumentMarket(market), ...FEED },
    });
    return mapRows(data?.assets, (row) => toInstrument(row, market));
  }

  async getInstrument(id: AssetId): Promise<Instrument> {
    const data = await this.api.get<AssetDto>(`/assets-service/assets/${encodeURIComponent(id.value)}`, {
      query: { ...FEED },
    });
    // Fall back to the requested id when the payload omits it; sanitise odd symbols (indices, FX rates).
    const instrument = toInstrument(
      data && typeof data === 'object' ? { ...data, id: data.id ?? id.value } : null,
      'egypt',
      { sanitizeTicker: true },
    );
    if (!instrument) throw new UpstreamError(`Unexpected asset payload from Thndr for ${id.value}`);
    return instrument;
  }

  async getMarketQuotes(market: Market): Promise<Quote[]> {
    const data = await this.api.get<MarketwatchResponseDto>('/assets-service/assets/marketwatch', {
      query: { market: instrumentMarket(market) },
    });
    return mapRows(data?.assets, toQuote);
  }

  async getCandles(id: AssetId, resolution: CandleResolution, from: Date, to: Date): Promise<Candle[]> {
    const path = `/feed/advanced-charts/v2/${encodeURIComponent(id.value.toLowerCase())}/trades`;
    const data = await this.krakend.get<CandlesResponseDto>(path, {
      query: {
        resolution: WIRE_RESOLUTION[resolution],
        start_timestamp: Math.floor(from.getTime() / 1000),
        end_timestamp: Math.floor(to.getTime() / 1000),
      },
    });
    assertNoKrakendError(data, `GET ${path}`);
    return mapRows(data?.trades_candles, toCandle);
  }

  async getOrderBook(id: AssetId): Promise<OrderBook> {
    const data = await this.api.get<MarketDepthResponseDto>(
      `/assets-service/market-depth/${encodeURIComponent(id.value)}`,
    );
    return toOrderBook(data);
  }

  async getRecentTrades(id: AssetId, limit: number, before?: string): Promise<TapeTrade[]> {
    const data = await this.api.get<TradesBookResponseDto>(
      `/assets-service/market-depth/v3/trades-book/${encodeURIComponent(id.value)}`,
      { query: { page_size: limit, before } },
    );
    return mapRows(data?.trades, toTapeTrade);
  }

  async getMarketSession(market: Market, board?: string | null): Promise<MarketSession> {
    const [status, hours] = await Promise.all([
      this.api.get<MarketStatusDto>('/market-service/markets/status', {
        query: { market: accountMarket(market), market_exchange: statusExchange(market, board) },
      }),
      // Hours only enrich the answer: tolerate failures.
      this.api
        .get<MarketHoursDto>('/market-service/markets/hours', { query: { market: accountMarket(market) } })
        .catch(() => null),
    ]);
    return Object.freeze({
      market,
      isOpen: status?.is_active === true,
      opensAt: parseTimestamp(hours?.session_open),
      closesAt: parseTimestamp(hours?.session_close),
    });
  }

  async getMarketIndicators(market: Market): Promise<Quote[]> {
    const data = await this.api.get<MarketIndicatorsResponseDto>('/assets-service/assets/market-indicators', {
      query: { market: instrumentMarket(market), page_count: 100, ...FEED },
    });
    return mapRows(data?.results, indicatorToQuote);
  }

  async getIndexConstituents(indexId: AssetId): Promise<AssetId[]> {
    const data = await this.api.get<AssetDto>(`/assets-service/assets/${encodeURIComponent(indexId.value)}`);
    return toConstituentIds(data);
  }

  async getSimilarInstruments(id: AssetId, market: Market, limit: number): Promise<Instrument[]> {
    const data = await this.api.get<RecommendationsResponseDto>(
      `/assets-service/assets/${encodeURIComponent(id.value)}/recommendations`,
      { query: { market: instrumentMarket(market), recommendations_number: limit, ...FEED } },
    );
    return mapRows(data?.results, (row) => toInstrument(row, market));
  }

  async getScreeners(market: Market): Promise<Screener[]> {
    const data = await this.api.get<ScreenersResponseDto>('/users-service/screeners', {
      query: { market: accountMarket(market) },
    });
    return mapRows(data?.screeners, (row) => toScreener(row, market));
  }

  async getScreener(id: string): Promise<Screener> {
    let data: ScreenerDto | null;
    try {
      data = await this.api.get<ScreenerDto>(`/users-service/screeners/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) {
        throw new NotFoundError(`No saved screener with id "${id}".`);
      }
      throw error;
    }
    const screener = toScreener(
      data && typeof data === 'object' ? { ...data, id: data.id ?? id } : null,
      null,
    );
    if (!screener) throw new UpstreamError(`Unexpected screener payload from Thndr for ${id}`);
    return screener;
  }
}
