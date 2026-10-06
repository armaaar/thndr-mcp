import { ValidationError } from '../shared-kernel/errors';

export type ApprovalStatus = 'pending' | 'approved' | 'claimed' | 'rejected' | 'expired' | 'unknown';

export function parseApprovalStatus(raw: unknown): ApprovalStatus {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  switch (value) {
    case 'pending':
    case 'approved':
    case 'claimed':
    case 'rejected':
    case 'expired':
      return value;
    case 'declined':
    case 'denied':
      return 'rejected';
    default:
      return 'unknown';
  }
}

/**
 * A second-factor token request that the user must approve in the Thndr mobile app (docs/api/auth.md §2).
 */
export class DeviceApprovalRequest {
  private constructor(
    readonly id: string,
    readonly secret: string,
    readonly humanId: string,
    readonly createdAt: Date,
  ) {
    Object.freeze(this);
  }

  static of(input: { id: string; secret: string; humanId: string; createdAt: Date }): DeviceApprovalRequest {
    for (const [label, value] of [
      ['id', input.id],
      ['secret', input.secret],
    ] as const) {
      if (typeof value !== 'string' || value.length === 0) {
        throw new ValidationError(`Device approval request ${label} must not be empty`);
      }
    }
    return new DeviceApprovalRequest(input.id, input.secret, String(input.humanId ?? ''), input.createdAt);
  }

  /** Deep link the Thndr mobile app understands (same as the QR code ThndrX renders). */
  deepLink(deviceName: string): string {
    const params = new URLSearchParams({
      human_id: this.humanId,
      user_agent: deviceName,
      requestId: this.id,
    });
    return `thndr://goToRoute?routeName=HUMAN_ID&${params.toString()}`;
  }
}
