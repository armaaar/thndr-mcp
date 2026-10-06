import type { DeviceApprovalRequest } from '../../domain/identity/device-approval';

export type ApprovalInstructions = {
  humanId: string;
  deepLink: string;
  requestId: string;
  message: string;
};

export function approvalInstructions(
  request: DeviceApprovalRequest,
  userAgent: string,
): ApprovalInstructions {
  return {
    humanId: request.humanId,
    requestId: request.id,
    deepLink: request.deepLink(userAgent),
    message:
      'Open the Thndr app on your phone and approve the new login request' +
      (request.humanId ? ` (code ${request.humanId})` : '') +
      ', or open the deep link on the phone. Then call login_complete.',
  };
}
