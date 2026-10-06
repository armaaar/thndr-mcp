import { describe, expect, it } from 'vitest';
import { aListedInstrument, aTag } from '../../../../__tests__/support/discovery-builders';
import { setupMarketData } from '../../../../__tests__/support/fake-market-data';
import { GetTagInstruments } from '../get-tag-instruments';

function setup() {
  const deps = setupMarketData();
  deps.discovery.tags.egypt = [
    aTag({ instrumentCount: 3 }),
    aTag({ id: '179', slug: 'gold', name: 'Gold Funds', instrumentCount: null }),
  ];
  deps.discovery.tagInstruments['157'] = [
    aListedInstrument('AALR', { price: 265.53, changePercent: 1.46 }),
    aListedInstrument('ACAMD'),
    aListedInstrument('COMI'),
  ];
  deps.discovery.tagInstruments['179'] = [aListedInstrument('GOLD')];
  return deps;
}

describe('GetTagInstruments', () => {
  it('declares its contract', async () => {
    const uc = new GetTagInstruments(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_tag_instruments', kind: 'query', context: 'market-data' });
    for (const input of [{}, { tag: '' }, { tag: 'x', page: 0 }, { tag: 'x', limit: 51 }]) {
      await expect(uc.run(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('lists a page of a tag given by id, without looking the tag up', async () => {
    const deps = setup();
    const out = await new GetTagInstruments(deps).run({ tag: '157', limit: 2 });
    expect(deps.discovery.calls.getTags).toEqual([]);
    expect(deps.discovery.calls.getTagInstruments).toEqual([
      { tagId: '157', market: 'egypt', page: 1, pageSize: 2 },
    ]);
    expect(out).toMatchObject({ market: 'egypt', page: 1, pageSize: 2, total: 3, hasMore: true });
    expect(out.tag).toMatchObject({ id: '157', name: 'Sharia' });
    expect(out.instruments.map((i) => i.ticker)).toEqual(['AALR', 'ACAMD']);
    expect(out.instruments[0]).toMatchObject({ price: 265.53, changePercent: 1.46, currency: 'EGP' });

    const last = await new GetTagInstruments(deps).run({ tag: '157', limit: 2, page: 2 });
    expect(last).toMatchObject({ hasMore: false });
    expect(last.instruments.map((i) => i.ticker)).toEqual(['COMI']);
  });

  it('resolves a slug or a name, and guesses more pages when Thndr gives no count', async () => {
    const deps = setup();
    const out = await new GetTagInstruments(deps).run({ tag: 'gold', limit: 1 });
    expect(deps.discovery.calls.getTags).toEqual(['egypt']);
    expect(out).toMatchObject({ total: null, hasMore: true });
    expect(out.tag.name).toBe('Gold Funds');
    expect((await new GetTagInstruments(deps).run({ tag: 'Sharia' })).tag.id).toBe('157');
    expect((await new GetTagInstruments(deps).run({ tag: 'gold funds', limit: 5 })).hasMore).toBe(false);
  });

  it('answers NOT_FOUND with the known tags when nothing matches', async () => {
    const deps = setup();
    await expect(new GetTagInstruments(deps).run({ tag: 'crypto' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('Sharia, Gold Funds'),
    });
    deps.discovery.tags.us = [];
    await expect(new GetTagInstruments(deps).run({ tag: 'crypto', market: 'us' })).rejects.toThrow(
      'No us tag matches "crypto". Use get_tags for ids.',
    );
  });

  it('refuses markets without tags', async () => {
    await expect(new GetTagInstruments(setup()).run({ tag: '157', market: 'uae' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});
