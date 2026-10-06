import { ValidationError } from '../shared-kernel/errors';

/** An in-app notification (order events, triggered price alerts, announcements). */
export interface Notification {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly read: boolean;
  readonly createdAt: Date | null;
  /** Upstream type/action such as `price_alert_triggered`, when known. */
  readonly type: string | null;
}

export function createNotification(input: {
  id: string;
  title?: string | null;
  text?: string | null;
  read?: boolean;
  createdAt?: Date | null;
  type?: string | null;
}): Notification {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (id.length === 0) throw new ValidationError('Notification id must not be empty');
  const createdAt = input.createdAt ?? null;
  return Object.freeze({
    id,
    title: input.title ?? '',
    text: input.text ?? '',
    read: input.read === true,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? new Date(createdAt.getTime()) : null,
    type: input.type ?? null,
  });
}
