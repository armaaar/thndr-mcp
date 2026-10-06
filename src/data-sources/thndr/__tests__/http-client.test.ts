import { describe, expect, it, vi } from 'vitest';
import { fakeFetch, json } from '../../../__tests__/support/fake-fetch';
import { NotAuthenticatedError, UpstreamError } from '../../../application/errors';
import { describeError, rateLimitWaitMs, ThndrHttpClient } from '../http-client';

function tokens(...values: string[]) {
  let i = 0;
  return {
    getAccessToken: vi.fn(async () => values[Math.min(i++, values.length - 1)] as string),
    invalidate: vi.fn(),
  };
}

describe('ThndrHttpClient', () => {
  it('sends browser-equivalent headers and parses JSON', async () => {
    const fetch = fakeFetch(() => json({ ok: true }));
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test/',
      fetch,
      tokenProvider: tokens('T1'),
      runtimeVersion: '3.8.3',
    });
    const out = await client.get<{ ok: boolean }>('/x', {
      query: { a: 1, b: undefined, c: null, d: ['p', 'q'], e: true },
    });
    expect(out).toEqual({ ok: true });
    const call = fetch.calls[0];
    expect(call?.url).toBe('https://api.test/x?a=1&d=p&d=q&e=true');
    expect(call?.headers).toMatchObject({
      authorization: 'Bearer T1',
      'x-thndrx-runtime-version': '3.8.3',
      'x-language': 'en',
      accept: 'application/json',
    });
  });

  it('serialises bodies for every write verb and supports unauthenticated calls', async () => {
    const fetch = fakeFetch(() => json({}));
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      runtimeVersion: '1',
      language: 'ar',
    });
    await client.post('p', { a: 1 }, { auth: 'none' });
    await client.put('/p', { b: 2 }, { auth: 'none' });
    await client.patch('/p', { c: 3 }, { auth: 'none', headers: { 'x-extra': 'y' } });
    await client.delete('/p', { auth: 'none' });
    expect(fetch.calls.map((c) => [c.method, c.body])).toEqual([
      ['POST', { a: 1 }],
      ['PUT', { b: 2 }],
      ['PATCH', { c: 3 }],
      ['DELETE', undefined],
    ]);
    expect(fetch.calls[0]?.url).toBe('https://api.test/p');
    expect(fetch.calls[0]?.headers['content-type']).toBe('application/json');
    expect(fetch.calls[0]?.headers.authorization).toBeUndefined();
    expect(fetch.calls[2]?.headers['x-extra']).toBe('y');
    expect(fetch.calls[3]?.headers['x-language']).toBe('ar');
  });

  it('returns undefined for empty bodies and raw text for non-JSON', async () => {
    const fetch = fakeFetch(
      () => new Response(null, { status: 204 }),
      () => new Response('plain', { status: 200 }),
    );
    const client = new ThndrHttpClient({ baseUrl: 'https://api.test', fetch, runtimeVersion: '1' });
    expect(await client.get('/a', { auth: 'none' })).toBeUndefined();
    expect(await client.get('/b', { auth: 'none' })).toBe('plain');
  });

  it('refreshes the token once after a 401 and retries', async () => {
    const fetch = fakeFetch(
      () => json({ message: 'expired' }, 401),
      () => json({ v: 2 }),
    );
    const tp = tokens('OLD', 'NEW');
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tp,
      runtimeVersion: '1',
      logger,
    });
    expect(await client.get('/x')).toEqual({ v: 2 });
    expect(tp.invalidate).toHaveBeenCalledOnce();
    expect(fetch.calls.map((c) => c.headers.authorization)).toEqual(['Bearer OLD', 'Bearer NEW']);
    expect(logger.info).toHaveBeenCalled();
  });

  it('retries a rate-limited read once after the Retry-After wait', async () => {
    const fetch = fakeFetch(
      () => json({ message: 'Exceeded rate limit' }, 429, { 'retry-after': '2' }),
      () => json({ v: 2 }),
    );
    const sleep = vi.fn(async () => {});
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('T'),
      runtimeVersion: '1',
      sleep,
    });
    expect(await client.get('/x')).toEqual({ v: 2 });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetch.calls).toHaveLength(2);
  });

  it('reports a second 429, and never retries a rate-limited write', async () => {
    const fetch = fakeFetch(() => json({ message: 'Exceeded rate limit' }, 429));
    const sleep = vi.fn(async () => {});
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('T'),
      runtimeVersion: '1',
      sleep,
    });
    await expect(client.get('/x')).rejects.toThrow('Thndr API error 429 on GET /x: Exceeded rate limit');
    expect(fetch.calls).toHaveLength(2);
    await expect(client.post('/y', {})).rejects.toThrow('429 on POST /y');
    expect(fetch.calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('releases the body of a 429 or 401 response before retrying', async () => {
    const retried: Response[] = [];
    const keep = (response: Response) => {
      retried.push(response);
      return response;
    };
    const fetch = fakeFetch(
      () => keep(json({ message: 'Exceeded rate limit' }, 429)),
      () => keep(json({ message: 'expired' }, 401)),
      () => json({ v: 4 }),
    );
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('OLD', 'NEW'),
      runtimeVersion: '1',
      sleep: async () => {},
    });
    expect(await client.get('/x')).toEqual({ v: 4 });
    expect(retried.map((r) => r.bodyUsed)).toEqual([true, true]);
  });

  it('retries even when the rejected response body was already consumed', async () => {
    const fetch = fakeFetch(
      async () => {
        const response = json({}, 429);
        await response.text();
        return response;
      },
      () => json({ v: 5 }),
    );
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('T'),
      runtimeVersion: '1',
      sleep: async () => {},
    });
    expect(await client.get('/x')).toEqual({ v: 5 });
  });

  it('waits Retry-After seconds, capped at 5 s, or 1 s when absent or invalid', () => {
    expect(rateLimitWaitMs('3')).toBe(3_000);
    expect(rateLimitWaitMs('120')).toBe(5_000);
    expect(rateLimitWaitMs(null)).toBe(1_000);
    expect(rateLimitWaitMs('soon')).toBe(1_000);
    expect(rateLimitWaitMs('-1')).toBe(1_000);
  });

  it('waits for real when no sleep is injected', async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch(
      () => json({}, 429, { 'retry-after': '0' }),
      () => json({ v: 3 }),
    );
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('T'),
      runtimeVersion: '1',
    });
    const pending = client.get('/x');
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ v: 3 });
    vi.useRealTimers();
  });

  it('throws NotAuthenticatedError when the retry is still 401', async () => {
    const fetch = fakeFetch(() => json({}, 401));
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('A'),
      runtimeVersion: '1',
    });
    await expect(client.get('/x')).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('maps a persisting 403 to UpstreamError', async () => {
    const fetch = fakeFetch(() => json({ type: 'FORBIDDEN', message: 'no subscription' }, 403));
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch,
      tokenProvider: tokens('A'),
      runtimeVersion: '1',
    });
    await expect(client.get('/x')).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 403,
      upstreamCode: 'FORBIDDEN',
      message: 'Thndr API error 403 on GET /x: no subscription',
    });
  });

  it('maps error responses without a message', async () => {
    const fetch = fakeFetch(() => new Response('', { status: 500 }));
    const client = new ThndrHttpClient({ baseUrl: 'https://api.test', fetch, runtimeVersion: '1' });
    await expect(client.get('/x', { auth: 'none' })).rejects.toThrow('Thndr API error 500 on GET /x');
  });

  it('requires a token provider for authenticated calls', async () => {
    const client = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch: fakeFetch(() => json({})),
      runtimeVersion: '1',
    });
    await expect(client.get('/x')).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('wraps network failures', async () => {
    const failing = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const client = new ThndrHttpClient({ baseUrl: 'https://api.test', fetch: failing, runtimeVersion: '1' });
    await expect(client.get('/x', { auth: 'none' })).rejects.toThrow(UpstreamError);
    const failing2 = fakeFetch(() => {
      throw 'weird';
    });
    const client2 = new ThndrHttpClient({
      baseUrl: 'https://api.test',
      fetch: failing2,
      runtimeVersion: '1',
    });
    await expect(client2.get('/x', { auth: 'none' })).rejects.toThrow(/weird/);
  });

  it('falls back to global fetch', () => {
    expect(() => new ThndrHttpClient({ baseUrl: 'https://api.test', runtimeVersion: '1' })).not.toThrow();
  });
});

describe('describeError', () => {
  it.each([
    ['text body', 'oops', { message: 'oops' }],
    ['null', null, {}],
    ['number', 5, {}],
    ['message/code', { message: 'm', code: 'C' }, { message: 'm', code: 'C' }],
    ['detail/type', { detail: 'd', type: 'T' }, { message: 'd', code: 'T' }],
    ['nested error', { error: { message: 'n', code: 'N' } }, { message: 'n', code: 'N' }],
    ['string error + error_code', { error: 'e', error_code: 'E' }, { message: 'e', code: 'E' }],
    ['title only', { title: 't' }, { message: 't', code: undefined }],
    [
      'fastapi detail object',
      { detail: { msg: 'Invalid token', type: 'INVALID_TOKEN' } },
      { message: 'Invalid token', code: 'INVALID_TOKEN' },
    ],
    [
      'fastapi detail string',
      { detail: 'Not authenticated' },
      { message: 'Not authenticated', code: undefined },
    ],
    ['array detail ignored', { detail: [{ msg: 'x' }] }, { message: undefined, code: undefined }],
  ])('%s', (_label, payload, expected) => {
    expect(describeError(payload)).toEqual(expected);
  });
});
