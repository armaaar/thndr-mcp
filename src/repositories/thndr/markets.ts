import type { Market } from '../../domain/shared-kernel/market';

/**
 * Thndr's wire codes per market (ADR 0021, docs/api/mobile-app.md §1). The UAE has two: `adsm` for instrument data
 * (search, details, charts) and `abudhabi` for account data and the mobile gateway.
 */
const ACCOUNT_MARKET: Readonly<Record<Market, string>> = {
  egypt: 'egypt',
  us: 'us',
  uae: 'abudhabi',
  simulator: 'simulator',
};

const INSTRUMENT_MARKET: Readonly<Record<Market, string>> = {
  egypt: 'egypt',
  us: 'us',
  uae: 'adsm',
  // The simulator trades Egypt's instruments; Thndr's search answers for `simulator` with Egyptian (and US) listings.
  simulator: 'simulator',
};

/** `provider` of `funding-service/account-activities` (no feed for the simulator). */
export const ACTIVITY_PROVIDER: Readonly<Record<Market, string | null>> = {
  egypt: 'EGID',
  us: 'ALPACA',
  uae: 'ADX_UAE',
  simulator: null,
};

/** `market` of account endpoints: wallet, positions, orders, returns, journal, watchlists, alerts, status. */
export function accountMarket(market: Market): string {
  return ACCOUNT_MARKET[market];
}

/** `market` of instrument endpoints: search, marketwatch, charts, recommendations, indicators. */
export function instrumentMarket(market: Market): string {
  return INSTRUMENT_MARKET[market];
}

/** `market_exchange` of `market-service/markets/status`: the board for Egypt (main board by default). */
export function statusExchange(market: Market, board?: string | null): string {
  if (market === 'us') return 'NOPL';
  if (market === 'uae') return 'adsm';
  return board || 'NOPL';
}

/** The market a wire code names, or null for codes thndr-mcp does not serve (e.g. `tdwl`). */
export function marketFromWire(raw: unknown): Market | null {
  switch (typeof raw === 'string' ? raw.trim().toLowerCase() : '') {
    case 'egypt':
      return 'egypt';
    case 'us':
      return 'us';
    case 'adsm':
    case 'abudhabi':
      return 'uae';
    case 'simulator':
    case 'boom_sim':
      return 'simulator';
    default:
      return null;
  }
}
