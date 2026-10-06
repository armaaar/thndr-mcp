import { describe, expect, it } from 'vitest';
import {
  approvalRequest,
  fakeIdentity,
  loginDeps,
  USER_AGENT,
} from '../../../../__tests__/support/identity-fakes';
import { DeviceApprovalRequester } from '../device-approval-requester';

describe('DeviceApprovalRequester', () => {
  it('creates a request for the identified user, records it in the flow and returns instructions', async () => {
    const deps = loginDeps();
    const instructions = await new DeviceApprovalRequester(deps).request();
    expect(deps.gateway.createApprovalRequest).toHaveBeenCalledWith('id-token');
    expect(deps.flow.current.requireAwaitingApproval()).toBe(approvalRequest);
    expect(instructions).toMatchObject({ requestId: approvalRequest.id, humanId: approvalRequest.humanId });
    expect(instructions.deepLink).toBe(approvalRequest.deepLink(USER_AGENT));
  });

  it('refuses when nobody is identified with Firebase', async () => {
    const deps = loginDeps({ identity: fakeIdentity(null) });
    await expect(new DeviceApprovalRequester(deps).request()).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
    expect(deps.gateway.createApprovalRequest).not.toHaveBeenCalled();
  });
});
