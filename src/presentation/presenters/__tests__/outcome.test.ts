import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeQuery } from '../../../__tests__/support/fake-use-cases';
import { fakeLogger } from '../../../__tests__/support/identity-fakes';
import { NotFoundError } from '../../../application/errors';
import { runAndPresent } from '../outcome';

describe('runAndPresent', () => {
  it('runs the use case with validated input and presents the result as a view', async () => {
    const uc = new FakeQuery({
      name: 'echo',
      input: { limit: z.number().default(3) },
      handler: ({ limit }) => ({ limit, at: new Date(0), skipped: undefined }),
    });
    expect(await runAndPresent(uc, {})).toEqual({
      ok: true,
      view: { limit: 3, at: '1970-01-01T00:00:00.000Z' },
    });
    expect(
      await runAndPresent(new FakeQuery({ name: 'nothing', handler: () => undefined }), undefined),
    ).toEqual({
      ok: true,
      view: null,
    });
  });

  it('flags contract violations as invalid input without logging them', async () => {
    const logger = fakeLogger();
    const uc = new FakeQuery({ name: 'strict', input: { limit: z.number().int().min(1) } });
    const outcome = await runAndPresent(uc, { limit: 0, extra: true }, logger);
    expect(outcome).toMatchObject({ ok: false, invalidInput: true, error: { error: 'INVALID_INPUT' } });
    expect(outcome.ok === false && outcome.error.message).toMatch(/limit/);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('presents application errors and unexpected errors without the invalid-input flag', async () => {
    const logger = fakeLogger();
    const missing = new FakeQuery({
      name: 'missing',
      handler: () => {
        throw new NotFoundError('No thing');
      },
    });
    expect(await runAndPresent(missing, {}, logger)).toEqual({
      ok: false,
      invalidInput: false,
      error: { error: 'NOT_FOUND', message: 'No thing' },
    });
    expect(logger.error).not.toHaveBeenCalled();

    const boom = new FakeQuery({
      name: 'boom',
      handler: () => {
        throw new Error('kaput');
      },
    });
    expect(await runAndPresent(boom, {}, logger)).toEqual({
      ok: false,
      invalidInput: false,
      error: { error: 'INTERNAL_ERROR', message: 'kaput' },
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
