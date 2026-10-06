import { describe, expect, it } from 'vitest';
import { DeleteAlert } from '../../../../src/application/engagement/commands/delete-alert';
import { ValidationError } from '../../../../src/domain/shared-kernel/errors';
import { anAlert, engagementSetup, FakeEngagementRepository } from '../../../support/fake-engagement';

describe('DeleteAlert contract', () => {
  const uc = new DeleteAlert(engagementSetup());

  it('is the destructive, idempotent delete_alert command', () => {
    expect(uc).toMatchObject({
      name: 'delete_alert',
      kind: 'command',
      context: 'engagement',
      destructive: true,
      idempotent: true,
    });
    expect(Object.keys(uc.input)).toEqual(['id']);
  });

  it('rejects unknown fields and invalid input', async () => {
    await expect(uc.run({ id: 'a-1', market: 'egypt' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(uc.run({ id: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('DeleteAlert', () => {
  it('deletes by id', async () => {
    const deps = engagementSetup(new FakeEngagementRepository({ alerts: [anAlert()] }));
    expect(await new DeleteAlert(deps).execute({ id: 'a-1' })).toEqual({ id: 'a-1', deleted: true });
    expect(deps.repository.calls.deletePriceAlert).toEqual(['a-1']);
    await expect(new DeleteAlert(deps).execute({ id: '' })).rejects.toThrow(ValidationError);
  });
});
