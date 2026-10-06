import { type Market, marketSupports } from '../../../domain/shared-kernel/market';

/**
 * The market whose whole-market snapshot (marketwatch) serves `market`, or null when there is none (ADR 0021). Egypt
 * has its own; the simulator trades Egypt's listings and its own marketwatch answers 400, so it reads Egypt's; the US
 * and the UAE have none (Thndr answers 400), so callers must never ask for it.
 */
export function snapshotMarket(market: Market): Market | null {
  if (market === 'simulator') return 'egypt';
  return marketSupports(market, 'marketSnapshot') ? market : null;
}
