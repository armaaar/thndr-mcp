import { type Market, marketSupports } from '../../../domain/shared-kernel/market';

/**
 * The market whose whole-market snapshot (marketwatch) serves `market`, or null when there is none (ADR 0021). Egypt
 * has its own; the simulator trades Egypt's listings and its own marketwatch answers 400, so it reads Egypt's; the US
 * and the UAE have none (Thndr answers 400), so callers must never ask for it.
 */
export function snapshotMarket(market: Market): Market | null {
  const data = dataMarket(market);
  return marketSupports(data, 'marketSnapshot') ? data : null;
}

/**
 * The market whose instrument data (candles, closes, indices, recommendations) serves an instrument of `market`: its
 * own, except the simulator, whose listings are Egypt's (an instrument reports `simulator` when Thndr's payload says
 * so or omits its market in a simulator search). Every market-data use case routes through it, so one instrument is
 * treated the same way by every tool.
 */
export function dataMarket(market: Market): Market {
  return market === 'simulator' ? 'egypt' : market;
}
