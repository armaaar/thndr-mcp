import { describe, expect, it } from 'vitest';
import {
  assetIdOrNull,
  emptyLabel,
  InstrumentLabels,
} from '../../../../src/application/engagement/services/instrument-labels';
import { AssetId } from '../../../../src/domain/market-data/asset-id';
import { idFor } from '../../../support/fake-market-data';

describe('InstrumentLabels', () => {
  it('returns the stored label, or an empty one for unknown ids', () => {
    const label = { ...emptyLabel(idFor('COMI')), ticker: 'COMI' };
    const labels = new InstrumentLabels(new Map([[idFor('COMI'), label]]));
    expect(labels.get(AssetId.of(idFor('COMI')))).toBe(label);
    expect(labels.get(AssetId.of(idFor('HRHO')))).toEqual(emptyLabel(idFor('HRHO')));
  });
});

describe('emptyLabel', () => {
  it('has only the id', () => {
    expect(emptyLabel('x')).toEqual({
      instrumentId: 'x',
      ticker: null,
      name: null,
      last: null,
      changePercent: null,
    });
  });
});

describe('assetIdOrNull', () => {
  it('parses UUIDs only', () => {
    expect(assetIdOrNull(idFor('COMI').toUpperCase())?.value).toBe(idFor('COMI'));
    expect(assetIdOrNull('COMI')).toBeNull();
  });
});
