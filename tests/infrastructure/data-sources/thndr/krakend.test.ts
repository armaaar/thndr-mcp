import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../../../src/application/errors';
import { assertNoKrakendError } from '../../../../src/infrastructure/data-sources/thndr/krakend';

function caught(payload: unknown, context?: string): UpstreamError {
  try {
    assertNoKrakendError(payload, context);
  } catch (error) {
    if (error instanceof UpstreamError) return error;
    throw error;
  }
  throw new Error('expected an UpstreamError');
}

describe('assertNoKrakendError', () => {
  it('ignores payloads without krakend error keys', () => {
    for (const payload of [
      undefined,
      null,
      'text',
      42,
      [],
      [{ error_x: { http_status_code: 500 } }],
      { trades_candles: [] },
    ]) {
      expect(() => assertNoKrakendError(payload)).not.toThrow();
    }
  });

  it('ignores error_* keys whose value is not a backend error', () => {
    expect(() =>
      assertNoKrakendError({ error_rate: 0.5, error_note: 'x', error_null: null, error_obj: { foo: 1 } }),
    ).not.toThrow();
  });

  it('throws with status, message and type from the backend body', () => {
    const error = caught(
      {
        trades_candles: [],
        'error_error_feed-historicals-service': {
          http_status_code: 503,
          http_body: JSON.stringify({ detail: { msg: 'Service unavailable', type: 'SERVICE_DOWN' } }),
        },
      },
      'GET /feed/x',
    );
    expect(error.status).toBe(503);
    expect(error.upstreamCode).toBe('SERVICE_DOWN');
    expect(error.message).toBe(
      'Thndr API error 503 on GET /feed/x (error_error_feed-historicals-service): Service unavailable',
    );
  });

  it('tolerates unparsable or unexpected bodies', () => {
    const raw = caught({
      error_asset_price: { http_status_code: 502, http_body: '<html>bad gateway</html>' },
    });
    expect(raw.message).toBe('Thndr API error 502 on krakend (error_asset_price): <html>bad gateway</html>');
    expect(raw.upstreamCode).toBeUndefined();

    const noDetail = caught({ error_asset_price: { http_status_code: 500, http_body: '{"oops":true}' } });
    expect(noDetail.message).toBe('Thndr API error 500 on krakend (error_asset_price): {"oops":true}');

    const nullJson = caught({ error_asset_price: { http_status_code: 500, http_body: 'null' } });
    expect(nullJson.message).toContain(': null');

    const wrongTypes = caught({
      error_asset_price: { http_status_code: 500, http_body: '{"detail":{"msg":1,"type":2}}' },
    });
    expect(wrongTypes.message).toBe('Thndr API error 500 on krakend (error_asset_price)');
    expect(wrongTypes.upstreamCode).toBeUndefined();
  });

  it('handles a missing status code or body', () => {
    const noStatus = caught({ error_full_trades: { http_body: '{"detail":{"msg":"m","type":"T"}}' } });
    expect(noStatus.status).toBeUndefined();
    expect(noStatus.message).toBe('Thndr API error on krakend (error_full_trades): m');

    const noBody = caught({ error_full_trades: { http_status_code: 404 } });
    expect(noBody.message).toBe('Thndr API error 404 on krakend (error_full_trades)');

    const emptyBody = caught({ error_full_trades: { http_status_code: '500', http_body: '' } });
    expect(emptyBody.status).toBeUndefined();
  });
});
