import { AssetId } from '../../../domain/market-data/asset-id';

/** What we know about an instrument id for presentation: its ticker and, when available, its live quote. */
export interface InstrumentLabel {
  readonly instrumentId: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly last: number | null;
  readonly changePercent: number | null;
}

/** Labels keyed by asset id; ids that were never labelled get an all-null label. */
export class InstrumentLabels {
  constructor(private readonly byId: ReadonlyMap<string, InstrumentLabel>) {}

  get(id: AssetId): InstrumentLabel {
    return this.byId.get(id.value) ?? emptyLabel(id.value);
  }
}

export function emptyLabel(instrumentId: string): InstrumentLabel {
  return { instrumentId, ticker: null, name: null, last: null, changePercent: null };
}

/** Parses a raw id string the way labels are keyed; returns null for non-UUIDs. */
export function assetIdOrNull(raw: string): AssetId | null {
  return AssetId.isAssetId(raw) ? AssetId.of(raw) : null;
}
