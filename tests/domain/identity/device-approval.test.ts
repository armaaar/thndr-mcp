import { describe, expect, it } from 'vitest';
import { DeviceApprovalRequest, parseApprovalStatus } from '../../../src/domain/identity/device-approval';
import { ValidationError } from '../../../src/domain/shared-kernel/errors';

const createdAt = new Date('2026-01-01T00:00:00Z');

describe('parseApprovalStatus', () => {
  it.each([
    ['pending', 'pending'],
    ['APPROVED', 'approved'],
    ['claimed', 'claimed'],
    ['rejected', 'rejected'],
    ['Expired', 'expired'],
    ['declined', 'rejected'],
    ['DENIED', 'rejected'],
    ['something', 'unknown'],
    [undefined, 'unknown'],
    [3, 'unknown'],
  ])('%j → %s', (raw, expected) => {
    expect(parseApprovalStatus(raw)).toBe(expected);
  });
});

describe('DeviceApprovalRequest', () => {
  it('builds a frozen request', () => {
    const request = DeviceApprovalRequest.of({ id: 'r1', secret: 's1', humanId: '123', createdAt });
    expect(request).toMatchObject({ id: 'r1', secret: 's1', humanId: '123', createdAt });
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('coerces a missing human id to an empty string', () => {
    const request = DeviceApprovalRequest.of({
      id: 'r1',
      secret: 's1',
      humanId: undefined as unknown as string,
      createdAt,
    });
    expect(request.humanId).toBe('');
  });

  it.each([
    [{ id: '', secret: 's' }, 'Device approval request id must not be empty'],
    [{ id: 'r', secret: '' }, 'Device approval request secret must not be empty'],
    [{ id: 5, secret: 's' }, 'Device approval request id must not be empty'],
  ])('rejects %j', (input, message) => {
    expect(() =>
      DeviceApprovalRequest.of({ ...(input as { id: string; secret: string }), humanId: '1', createdAt }),
    ).toThrow(new ValidationError(message));
  });

  it('builds the Thndr app deep link', () => {
    const request = DeviceApprovalRequest.of({ id: 'r 1', secret: 's1', humanId: '42', createdAt });
    expect(request.deepLink('thndr-mcp/1.0')).toBe(
      'thndr://goToRoute?routeName=HUMAN_ID&human_id=42&user_agent=thndr-mcp%2F1.0&requestId=r+1',
    );
  });
});
