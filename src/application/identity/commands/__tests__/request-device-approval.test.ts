import { describe, expect, it } from 'vitest';
import { fakeGateway, fakeIdentity, loginDeps, T0 } from '../../../../__tests__/support/identity-fakes';
import { DeviceApprovalRequest } from '../../../../domain/identity/device-approval';
import { NotAuthenticatedError } from '../../../errors';
import { InvalidInputError } from '../../../use-case';
import { RequestDeviceApproval } from '../request-device-approval';

describe('RequestDeviceApproval', () => {
  it('declares its contract', () => {
    const uc = new RequestDeviceApproval(loginDeps());
    expect(uc).toMatchObject({
      name: 'login_request_approval',
      kind: 'command',
      context: 'identity',
      destructive: false,
      idempotent: false,
    });
    expect(uc.input).toEqual({});
  });

  it('requires a Firebase identity', async () => {
    const d = loginDeps({ identity: fakeIdentity(null) });
    await expect(new RequestDeviceApproval(d).execute()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(d.gateway.createApprovalRequest).not.toHaveBeenCalled();
  });

  it('omits the code from the message when there is no human id', async () => {
    const request = DeviceApprovalRequest.of({ id: 'r2', secret: 's2', humanId: '', createdAt: T0 });
    const d = loginDeps({ gateway: fakeGateway({ createApprovalRequest: async () => request }) });
    const result = await new RequestDeviceApproval(d).execute();
    expect(result.message).toBe(
      'Open the Thndr app on your phone and approve the new login request, or open the deep link on the ' +
        'phone. Then call login_complete.',
    );
    expect(d.flow.current.requireAwaitingApproval()).toBe(request);
  });

  it('validates input in run()', async () => {
    const d = loginDeps();
    const uc = new RequestDeviceApproval(d);
    await expect(uc.run({ email: 'a@example.com' })).rejects.toBeInstanceOf(InvalidInputError);
    expect(d.gateway.createApprovalRequest).not.toHaveBeenCalled();
    await expect(uc.run(undefined)).resolves.toMatchObject({ requestId: 'req-1' });
  });
});
