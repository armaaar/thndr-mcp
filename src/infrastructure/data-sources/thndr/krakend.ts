import { UpstreamError } from '../../../application/errors';
import type { KrakendBackendErrorDto } from './dto/market-data';

/**
 * Replicates ThndrX's `M.p4` response interceptor (docs/api/market-data.md §0.2). Krakend aggregates several
 * backends and answers HTTP 200 even when one fails; the failure shows up as an extra top-level `error_*` key
 * whose value is `{ http_status_code, http_body }` with `http_body` = `{"detail":{"msg":..,"type":..}}`.
 * Every call to the krakend base URL must go through this check.
 */
export function assertNoKrakendError(payload: unknown, context = 'krakend'): void {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return;
  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith('error_') || !isBackendError(value)) continue;
    const status = typeof value.http_status_code === 'number' ? value.http_status_code : undefined;
    const { msg, type } = parseBody(value.http_body);
    throw new UpstreamError(
      `Thndr API error${status === undefined ? '' : ` ${status}`} on ${context} (${key})${msg ? `: ${msg}` : ''}`,
      status,
      type,
    );
  }
}

function isBackendError(value: unknown): value is KrakendBackendErrorDto {
  return value !== null && typeof value === 'object' && ('http_status_code' in value || 'http_body' in value);
}

function parseBody(body: unknown): { msg?: string; type?: string } {
  if (typeof body !== 'string' || body.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    const detail = (parsed as { detail?: unknown } | null)?.detail;
    if (detail === null || typeof detail !== 'object') return { msg: body.slice(0, 300) };
    const { msg, type } = detail as { msg?: unknown; type?: unknown };
    return {
      msg: typeof msg === 'string' ? msg : undefined,
      type: typeof type === 'string' ? type : undefined,
    };
  } catch {
    return { msg: body.slice(0, 300) };
  }
}
