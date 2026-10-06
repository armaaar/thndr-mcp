import { describe, expect, it } from 'vitest';
import {
  ApplicationError,
  FeatureDisabledError,
  NotAuthenticatedError,
  NotFoundError,
  SessionExpiredError,
  UpstreamError,
} from '../../src/application/errors';

describe('application errors', () => {
  it('NotAuthenticatedError has a default and custom message', () => {
    const error = new NotAuthenticatedError();
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NOT_AUTHENTICATED');
    expect(error.name).toBe('NotAuthenticatedError');
    expect(error.message).toContain('login_start');
    expect(new NotAuthenticatedError('custom').message).toBe('custom');
  });

  it('UpstreamError carries status, upstream code and cause', () => {
    const cause = new Error('boom');
    const error = new UpstreamError('bad', 502, 'GATEWAY', { cause });
    expect(error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502,
      upstreamCode: 'GATEWAY',
      message: 'bad',
    });
    expect(error.name).toBe('UpstreamError');
    expect(error.cause).toBe(cause);
    const bare = new UpstreamError('bare');
    expect(bare.status).toBeUndefined();
    expect(bare.upstreamCode).toBeUndefined();
  });

  it('NotFoundError and FeatureDisabledError', () => {
    const notFound = new NotFoundError('missing');
    expect(notFound).toMatchObject({ code: 'NOT_FOUND', name: 'NotFoundError', message: 'missing' });
    const disabled = new FeatureDisabledError('off', { cause: 'cfg' });
    expect(disabled).toMatchObject({
      code: 'FEATURE_DISABLED',
      name: 'FeatureDisabledError',
      message: 'off',
    });
    expect(disabled.cause).toBe('cfg');
  });

  it('SessionExpiredError has a default and custom message', () => {
    const error = new SessionExpiredError();
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(error.name).toBe('SessionExpiredError');
    expect(error.message).toContain('login_request_approval');
    expect(new SessionExpiredError('again').message).toBe('again');
  });
});
