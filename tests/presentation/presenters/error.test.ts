import { describe, expect, it } from 'vitest';
import { NotAuthenticatedError, NotFoundError, UpstreamError } from '../../../src/application/errors';
import { BusinessRuleViolation, ValidationError } from '../../../src/domain/shared-kernel/errors';
import { presentError } from '../../../src/presentation/presenters/error';
import { fakeLogger } from '../../support/identity-fakes';

describe('presentError', () => {
  it('presents domain errors with their code and does not log them', () => {
    const logger = fakeLogger();
    expect(presentError(new ValidationError('bad ticker'), logger)).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'bad ticker',
    });
    expect(presentError(new BusinessRuleViolation('MARKET_CLOSED', 'closed'), logger)).toEqual({
      error: 'MARKET_CLOSED',
      message: 'closed',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('presents application errors with their code', () => {
    expect(presentError(new NotFoundError('nope'))).toEqual({ error: 'NOT_FOUND', message: 'nope' });
    expect(presentError(new NotAuthenticatedError())).toMatchObject({ error: 'NOT_AUTHENTICATED' });
  });

  it('adds status and upstream code of upstream errors when present', () => {
    expect(presentError(new UpstreamError('boom', 502, 'GATEWAY'))).toEqual({
      error: 'UPSTREAM_ERROR',
      message: 'boom',
      status: 502,
      upstreamCode: 'GATEWAY',
    });
    expect(presentError(new UpstreamError('boom', 500))).toEqual({
      error: 'UPSTREAM_ERROR',
      message: 'boom',
      status: 500,
    });
    expect(presentError(new UpstreamError('no status', undefined, ''))).toEqual({
      error: 'UPSTREAM_ERROR',
      message: 'no status',
    });
  });

  it('hides unexpected errors behind INTERNAL_ERROR and logs them', () => {
    const logger = fakeLogger();
    const error = new TypeError('x is undefined');
    expect(presentError(error, logger)).toEqual({ error: 'INTERNAL_ERROR', message: 'x is undefined' });
    expect(logger.error).toHaveBeenCalledWith('operation: unexpected error', { error });
  });

  it('stringifies non-Error throwables and works without a logger', () => {
    const logger = fakeLogger();
    expect(presentError('kaput', logger)).toEqual({ error: 'INTERNAL_ERROR', message: 'kaput' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(presentError(42)).toEqual({ error: 'INTERNAL_ERROR', message: '42' });
  });
});
