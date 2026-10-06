import { describe, expect, it } from 'vitest';
import { LoginFlowHolder } from '../../../src/application/identity/login-flow-holder.js';
import { Email } from '../../../src/domain/identity/email.js';

describe('LoginFlowHolder', () => {
  it('starts idle, stores and resets the flow', () => {
    const holder = new LoginFlowHolder();
    expect(holder.current.stage).toBe('IDLE');
    const next = holder.current.codeSent(Email.of('a@example.com'), 'v1');
    holder.set(next);
    expect(holder.current).toBe(next);
    holder.reset();
    expect(holder.current.stage).toBe('IDLE');
    expect(holder.current.email).toBeNull();
  });
});
