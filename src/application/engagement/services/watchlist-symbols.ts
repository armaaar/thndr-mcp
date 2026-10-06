import { uniqueAssetIds } from '../../../domain/engagement/watchlist';
import type { AssetId } from '../../../domain/shared-kernel/asset-id';
import { ValidationError } from '../../../domain/shared-kernel/errors';
import type { Market } from '../../../domain/shared-kernel/market';
import { MAX_SYMBOLS_PER_CALL } from '../constants';
import type { EngagementDependencies } from '../dependencies';

/** Rejects lists longer than {@link MAX_SYMBOLS_PER_CALL}; `label` names the offending field. */
export function checkSymbolCount(symbols: readonly string[] | undefined, label: string): readonly string[] {
  const list = symbols ?? [];
  if (list.length > MAX_SYMBOLS_PER_CALL) {
    throw new ValidationError(`At most ${MAX_SYMBOLS_PER_CALL} symbols in "${label}"`);
  }
  return list;
}

/** Resolves symbols (tickers or asset ids) to unique asset ids. */
export async function resolveIds(
  deps: Pick<EngagementDependencies, 'resolver'>,
  symbols: readonly string[],
  market: Market,
): Promise<AssetId[]> {
  const instruments = await deps.resolver.resolveMany(symbols, market);
  return uniqueAssetIds(instruments.map((i) => i.id));
}
