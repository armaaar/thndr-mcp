import { randomUUID } from 'node:crypto';
import { NotAuthenticatedError, UpstreamError } from '../../../application/errors';
import type { AccessTokenProvider } from '../../../application/ports/access-token-provider';
import type { Logger } from '../../../application/ports/logger';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | undefined | null | ReadonlyArray<string | number>;
export type FetchFn = typeof fetch;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** `full` (default) attaches the full-access bearer token; `none` sends no authorization header. */
  auth?: 'full' | 'none';
  headers?: Record<string, string>;
}

export interface ThndrHttpClientOptions {
  baseUrl: string;
  fetch?: FetchFn;
  tokenProvider?: AccessTokenProvider;
  runtimeVersion: string;
  language?: 'ar' | 'en';
  timeoutMs?: number;
  logger?: Logger;
  /** Generates the per-request `X-Correlation-ID` (ThndrX sends a UUID on every call). */
  correlationId?: () => string;
  userAgent?: string;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

/**
 * Minimal browser-equivalent HTTP client for Thndr endpoints (ADR 0004). Mirrors the ThndrX axios interceptors:
 * bearer token, `x-thndrx-runtime-version` and `X-Language` headers, one retry after a 401/403 with a refreshed
 * token.
 */
export class ThndrHttpClient {
  private readonly fetchFn: FetchFn;

  constructor(private readonly options: ThndrHttpClientOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.exchange<T>(method, path, options)).data;
  }

  /** Like `request` but also returns status and headers (needed for `Set-Cookie`). */
  async exchange<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const auth = options.auth ?? 'full';
    let response = await this.send(method, path, options, auth);
    if (auth === 'full' && (response.status === 401 || response.status === 403)) {
      this.options.logger?.info('thndr: token rejected, refreshing and retrying once', { method, path });
      this.requireTokenProvider().invalidate();
      response = await this.send(method, path, options, auth);
      if (response.status === 401) {
        throw new NotAuthenticatedError('Thndr rejected the session. Please log in again (login_start).');
      }
    }
    return {
      status: response.status,
      data: await this.parse<T>(method, path, response),
      headers: response.headers,
    };
  }

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(
      this.options.baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`),
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) for (const v of value) url.searchParams.append(key, String(v));
      else url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private requireTokenProvider(): AccessTokenProvider {
    if (!this.options.tokenProvider) throw new NotAuthenticatedError('No token provider configured');
    return this.options.tokenProvider;
  }

  private async send(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    auth: 'full' | 'none',
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-thndrx-runtime-version': this.options.runtimeVersion,
      'X-Language': this.options.language ?? 'en',
      'X-Correlation-ID': (this.options.correlationId ?? randomUUID)(),
      ...(this.options.userAgent ? { 'user-agent': this.options.userAgent } : {}),
      ...options.headers,
    };
    if (auth === 'full')
      headers.authorization = `Bearer ${await this.requireTokenProvider().getAccessToken()}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const url = this.buildUrl(path, options.query);
    this.options.logger?.debug('thndr: request', { method, url });
    try {
      return await this.fetchFn(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      });
    } catch (cause) {
      throw new UpstreamError(
        `Network error calling Thndr (${method} ${path}): ${errorMessage(cause)}`,
        undefined,
        undefined,
        {
          cause,
        },
      );
    }
  }

  private async parse<T>(method: HttpMethod, path: string, response: Response): Promise<T> {
    const text = await response.text();
    let payload: unknown;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const { message, code } = describeError(payload);
      throw new UpstreamError(
        `Thndr API error ${response.status} on ${method} ${path}${message ? `: ${message}` : ''}`,
        response.status,
        code,
      );
    }
    return payload as T;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Best-effort extraction of a message and code from Thndr error bodies. Shapes seen (docs/api/*.md):
 * `{detail: {msg, type}}` (FastAPI services), `{detail: "Not authenticated"}`, `{type}` (Next.js routes),
 * `{message, code}`, `{error: {message, code}}`.
 */
export function describeError(payload: unknown): { message?: string; code?: string } {
  if (typeof payload === 'string') return { message: payload.slice(0, 300) };
  if (payload === null || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const asRecord = (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const nested = asRecord(record.detail) ?? asRecord(record.error);
  const pick = (...values: unknown[]) =>
    values.find((v): v is string => typeof v === 'string' && v.length > 0);
  return {
    message: pick(nested?.msg, nested?.message, record.message, record.detail, record.error, record.title),
    code: pick(nested?.type, nested?.code, record.code, record.type, record.error_code),
  };
}
