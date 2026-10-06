import type { Dividend, ListedInstrument, Mover, Tag } from '../../domain/market-data/discovery';
import { anInstrument } from './fake-market-data';

/** Builders of discovery read models (kept apart from FakeDiscoveryRepository to avoid an import cycle). */
export function aListedInstrument(
  ticker = 'COMI',
  overrides: Partial<ListedInstrument> = {},
): ListedInstrument {
  return {
    instrument: anInstrument({ ticker }),
    price: 100,
    previousClose: 98,
    changePercent: 2.04,
    ...overrides,
  };
}

export function aMover(ticker: string, returnPercent: number, overrides: Partial<Mover> = {}): Mover {
  return { ...aListedInstrument(ticker), returnPercent, ...overrides };
}

export function aTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: '157',
    slug: 'sharia',
    name: 'Sharia',
    about: 'Screened in accordance with Sharia principles.',
    instrumentCount: 89,
    featured: true,
    ...overrides,
  };
}

export function aDividend(overrides: Partial<Dividend> = {}): Dividend {
  return {
    id: '1086',
    type: 'CASH',
    status: 'PAST',
    recordDate: '2026-04-06',
    ratio: 6,
    currency: 'EGP',
    frequency: 'ONE_TIME',
    couponNumber: null,
    distributions: [{ date: '2026-04-09', ratio: 6 }],
    ...overrides,
  };
}
