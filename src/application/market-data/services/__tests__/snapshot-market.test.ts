import { describe, expect, it } from 'vitest';
import { snapshotMarket } from '../snapshot-market';

describe('snapshotMarket', () => {
  it('serves Egypt and the simulator from Egypt’s marketwatch, and nothing else', () => {
    expect(snapshotMarket('egypt')).toBe('egypt');
    expect(snapshotMarket('simulator')).toBe('egypt');
    expect(snapshotMarket('us')).toBeNull();
    expect(snapshotMarket('uae')).toBeNull();
  });
});
