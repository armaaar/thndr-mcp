import { describe, expect, it, vi } from 'vitest';
import { NotAuthenticatedError, UpstreamError } from '../../../src/application/errors.js';
import { describeError, ThndrHttpClient } from '../../../src/infrastructure/thndr/http-client.js';
import { fakeFetch, json } from '../../support/fake-fetch.js';

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
  ])('%s', (_label, payload, expected) => {
    expect(describeError(payload)).toEqual(expected);
  });
});
