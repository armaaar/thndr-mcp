import type { FetchFn } from '../../src/infrastructure/data-sources/thndr/http-client.js';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Responder = (req: RecordedRequest) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A scripted fetch: responders are consumed in order; the last one is reused. Records every request. */
export function fakeFetch(...responders: Responder[]): FetchFn & { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  let i = 0;
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else if (raw instanceof URLSearchParams) {
      body = Object.fromEntries(raw.entries());
    }
    const req: RecordedRequest = { url: String(input), method: init?.method ?? 'GET', headers, body };
    calls.push(req);
    const responder = responders[Math.min(i++, responders.length - 1)];
    if (!responder) throw new Error('fakeFetch: no responder');
    return responder(req);
  };
  return Object.assign(fn as FetchFn, { calls });
}
