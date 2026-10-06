/**
 * Captures real responses of the read-only Thndr endpoints this server uses, so the reverse-engineered DTOs
 * (docs/api/*.md, fields marked [I]nferred) can be verified against reality.
 *
 *   npm run login              # once, to create a session
 *   npm run capture:fixtures   # writes .cache/fixtures/*.json + a shape report
 *
 * Only GET requests are made. Personal fields (names, emails, phones, ids of people, addresses…) are redacted, but
 * balances and positions are kept — the output folder is git-ignored; review before sharing anything.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../../../src/config';
import { compose } from '../../../../src/container';
import { assertNoKrakendError } from '../../../../src/data-sources/thndr/krakend';

const OUT = resolve(process.argv[2] ?? '.cache/fixtures');
const PII =
  /(^|_)(name|first_name|last_name|full_name|email|phone|mobile|national|nid|address|iban|account_number|birth|user_id|investor)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 5).map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        PII.test(k) && typeof v === 'string' ? '[REDACTED]' : redact(v),
      ]),
    );
  }
  return value;
}

function shape(value: unknown, prefix = '', out = new Map<string, Set<string>>()): Map<string, Set<string>> {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (prefix) out.set(prefix, (out.get(prefix) ?? new Set()).add(type));
  if (Array.isArray(value)) for (const item of value) shape(item, `${prefix}[]`, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) shape(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

async function main(): Promise<void> {
  const app = compose(loadConfig());
  const { api, krakend } = app;
  const authStatus = app.useCases.find((u) => u.name === 'auth_status');
  const status = (await authStatus?.run({})) as { authenticated?: boolean } | undefined;
  if (!status?.authenticated) throw new Error('Not logged in. Run `npm run login` first.');

  // Seed an instrument id from the market snapshot (most traded EGX stock).
  const mw = await api.get<{ assets?: Array<{ asset_id: string; total_value?: number }> }>(
    '/assets-service/assets/marketwatch',
    { query: { market: 'egypt' } },
  );
  const id = [...(mw.assets ?? [])].sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0))[0]?.asset_id;
  if (!id) throw new Error('marketwatch returned no assets');
  const now = Math.floor(Date.now() / 1000);

  const targets: Array<[string, () => Promise<unknown>]> = [
    ['marketwatch', async () => mw],
    [
      'search',
      () =>
        api.get('/assets-service/assets/search', {
          query: { query: 'COMI', market: 'egypt', include_feed: true, feed_detail: true },
        }),
    ],
    [
      'asset',
      () => api.get(`/assets-service/assets/${id}`, { query: { include_feed: true, feed_detail: true } }),
    ],
    ['market-depth', () => api.get(`/assets-service/market-depth/${id}`)],
    [
      'trades-book',
      () => api.get(`/assets-service/market-depth/v3/trades-book/${id}`, { query: { page_size: 5 } }),
    ],
    [
      'market-indicators',
      () =>
        api.get('/assets-service/assets/market-indicators', {
          query: { market: 'egypt', page_count: 100, include_feed: true, feed_detail: true },
        }),
    ],
    [
      'market-status',
      () =>
        api.get('/market-service/markets/status', { query: { market: 'egypt', market_exchange: 'NOPL' } }),
    ],
    ['market-hours', () => api.get('/market-service/markets/hours', { query: { market: 'egypt' } })],
    [
      'candles',
      () =>
        krakend.get(`/feed/advanced-charts/v2/${id}/trades`, {
          query: { resolution: '1D', start_timestamp: now - 30 * 86400, end_timestamp: now },
        }),
    ],
    [
      'wallet-and-portfolio',
      () => api.get('/market-service/accounts/wallet-and-portfolio', { query: { market: 'egypt' } }),
    ],
    [
      'orders',
      () =>
        api.get('/market-service/v3/orders', {
          query: { market: 'egypt', limit: 5, sort_order: 'DESC', skip_funds: true },
        }),
    ],
    ['realized-returns', () => api.get('/market-service/realized-returns', { query: { market: 'egypt' } })],
    [
      'returns-chart-1M',
      () => api.get('/market-service/realized-returns/chart/1M', { query: { market: 'egypt' } }),
    ],
    [
      'full-trades',
      () =>
        api.get('/market-service/trading-journals/full-trades', {
          query: { market: 'egypt', page: 1, limit: 5 },
        }),
    ],
    [
      'grouped-sells',
      () =>
        krakend.get('/trading-journals/v1/grouped-sells', { query: { market: 'egypt', page: 1, limit: 5 } }),
    ],
    ['trading-metrics', () => krakend.get('/trading-journals/v1/trading-metrics')],
    [
      'account-activities',
      () =>
        api.get('/funding-service/account-activities', {
          query: { provider: 'EGID', page: 1, page_size: 5 },
        }),
    ],
    ['watchlists', () => api.get('/users-service/watchlists', { query: { market: 'egypt' } })],
    [
      'price-alerts',
      () => krakend.get('/price-alerts/v1/alerts', { query: { page: 1, page_count: 5, market: 'egypt' } }),
    ],
    ['notifications', () => krakend.get('/notifications/v1', { query: { page: 1, page_count: 5 } })],
  ];

  await mkdir(OUT, { recursive: true, mode: 0o700 });
  const report: string[] = ['# Captured response shapes', '', `Captured ${new Date().toISOString()}`, ''];
  for (const [name, fetchIt] of targets) {
    try {
      const data = await fetchIt();
      assertNoKrakendError(data);
      await writeFile(join(OUT, `${name}.json`), `${JSON.stringify(redact(data), null, 2)}\n`, {
        mode: 0o600,
      });
      report.push(
        `## ${name}`,
        '',
        ...[...shape(data)].map(([k, t]) => `- \`${k}\`: ${[...t].join(' | ')}`),
        '',
      );
      process.stdout.write(`✔ ${name}\n`);
    } catch (error) {
      report.push(`## ${name}`, '', `- ERROR: ${error instanceof Error ? error.message : String(error)}`, '');
      process.stdout.write(`✘ ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  await writeFile(join(OUT, 'SHAPES.md'), `${report.join('\n')}\n`, { mode: 0o600 });
  process.stdout.write(
    `\nWrote ${OUT}/SHAPES.md — compare it with docs/api/*.md and src/data-sources/thndr/dto/*.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
