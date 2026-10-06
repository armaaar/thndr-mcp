import { describe, expect, it } from 'vitest';
import { aTag } from '../../../../__tests__/support/fake-discovery';
import { setupMarketData } from '../../../../__tests__/support/fake-market-data';
import { GetTags } from '../get-tags';

describe('GetTags', () => {
  it('declares its contract', async () => {
    const uc = new GetTags(setupMarketData());
    expect(uc).toMatchObject({ name: 'get_tags', kind: 'query', context: 'market-data' });
    await expect(uc.run({ market: 'mars' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("lists the market's tags", async () => {
    const deps = setupMarketData();
    deps.discovery.tags.us = [
      aTag({ instrumentCount: 264 }),
      aTag({ id: '153', slug: 'Dividends', name: 'Dividend Players', about: null, featured: false }),
    ];
    const out = await new GetTags(deps).run({ market: 'us' });
    expect(deps.discovery.calls.getTags).toEqual(['us']);
    expect(out).toEqual({
      market: 'us',
      tags: [
        {
          id: '157',
          name: 'Sharia',
          slug: 'sharia',
          about: 'Screened in accordance with Sharia principles.',
          instrumentCount: 264,
          featured: true,
        },
        {
          id: '153',
          name: 'Dividend Players',
          slug: 'Dividends',
          about: null,
          instrumentCount: 89,
          featured: false,
        },
      ],
    });
  });

  it('refuses markets without tags', async () => {
    const deps = setupMarketData();
    await expect(new GetTags(deps).run({ market: 'uae' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    expect(deps.discovery.calls.getTags).toEqual([]);
  });
});
