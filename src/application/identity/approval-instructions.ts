import type { DeviceApprovalRequest } from '../../domain/identity/device-approval';

export type ApprovalInstructions = {
  humanId: string;
  deepLink: string;
  requestId: string;
  message: string;
};

export function approvalInstructions(
  request: DeviceApprovalRequest,
  deviceName: string,
): ApprovalInstructions {
  return {
    humanId: request.humanId,
    requestId: request.id,
    deepLink: request.deepLink(deviceName),
    message:
      'Approve the new login in the Thndr app on your phone' +
      (request.humanId ? ` (request ${request.humanId})` : '') +
      ': open the deep link on the phone, or scan it as a QR code with the phone camera or the Thndr app. Thndr ' +
      'sends no notification for it. Then call login_complete.',
  };
}
