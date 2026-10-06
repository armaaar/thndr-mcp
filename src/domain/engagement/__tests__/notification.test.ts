import { describe, expect, it } from 'vitest';
import { createNotification } from '../notification';

describe('createNotification', () => {
  it('defaults missing fields', () => {
    const n = createNotification({ id: ' n1 ' });
    expect(n).toEqual({ id: 'n1', title: '', text: '', read: false, createdAt: null, type: null });
    expect(Object.isFrozen(n)).toBe(true);
  });

  it('keeps every field and copies the date', () => {
    const createdAt = new Date('2026-01-01T10:00:00Z');
    const n = createNotification({
      id: 'n',
      title: 'T',
      text: 'X',
      read: true,
      createdAt,
      type: 'price_alert_triggered',
    });
    expect(n).toEqual({
      id: 'n',
      title: 'T',
      text: 'X',
      read: true,
      createdAt,
      type: 'price_alert_triggered',
    });
    expect(n.createdAt).not.toBe(createdAt);
  });

  it('drops invalid dates and rejects empty ids', () => {
    expect(createNotification({ id: 'n', createdAt: new Date('x') }).createdAt).toBeNull();
    expect(() => createNotification({ id: '' })).toThrow('Notification id must not be empty');
    expect(() => createNotification({ id: 1 as unknown as string })).toThrow(
      'Notification id must not be empty',
    );
  });
});
