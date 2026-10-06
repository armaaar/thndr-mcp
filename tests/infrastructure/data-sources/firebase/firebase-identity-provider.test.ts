import type { Auth, Persistence, User } from '@firebase/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  type FirebaseAuthSdk,
  FirebaseIdentityProvider,
  THNDR_FIREBASE_CONFIG,
} from '../../../../src/infrastructure/data-sources/firebase/firebase-identity-provider.js';

const persistence = { type: 'LOCAL' } as unknown as Persistence;

function fakeSdk(currentUser: User | null = null) {
  const app = { name: 'app' };
  const auth = { currentUser, authStateReady: vi.fn(async () => undefined) };
  const sdk = {
    initializeApp: vi.fn(() => app),
    initializeAuth: vi.fn(() => auth),
    signInWithCustomToken: vi.fn(async () => ({})),
    getIdToken: vi.fn(async () => 'id-token'),
    signOut: vi.fn(async () => undefined),
  };
  return { sdk, app, auth, typed: sdk as unknown as FirebaseAuthSdk };
}

describe('FirebaseIdentityProvider', () => {
  it('lazily initialises the app and auth once, with the ThndrX config and our persistence', async () => {
    const { sdk, app, auth, typed } = fakeSdk();
    const provider = new FirebaseIdentityProvider(persistence, typed);
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    await provider.getIdToken();
    await provider.signOut();
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledWith(THNDR_FIREBASE_CONFIG, 'thndr-mcp');
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAuth).toHaveBeenCalledWith(app, { persistence });
    expect(auth.authStateReady).toHaveBeenCalledTimes(2);
  });

  it('uses a custom app name', async () => {
    const { sdk, typed } = fakeSdk();
    await new FirebaseIdentityProvider(persistence, typed, 'other').getIdToken();
    expect(sdk.initializeApp).toHaveBeenCalledWith(THNDR_FIREBASE_CONFIG, 'other');
  });

  it('returns null when nobody is signed in', async () => {
    const { sdk, typed } = fakeSdk(null);
    await expect(new FirebaseIdentityProvider(persistence, typed).getIdToken()).resolves.toBeNull();
    expect(sdk.getIdToken).not.toHaveBeenCalled();
  });

  it('returns the current user ID token', async () => {
    const user = { uid: 'u1' } as unknown as User;
    const { sdk, typed } = fakeSdk(user);
    await expect(new FirebaseIdentityProvider(persistence, typed).getIdToken()).resolves.toBe('id-token');
    expect(sdk.getIdToken).toHaveBeenCalledWith(user);
  });

  it('signs in with a custom token and signs out', async () => {
    const { sdk, auth, typed } = fakeSdk();
    const provider = new FirebaseIdentityProvider(persistence, typed);
    await provider.signInWithCustomToken('custom');
    expect(sdk.signInWithCustomToken).toHaveBeenCalledWith(auth as unknown as Auth, 'custom');
    await provider.signOut();
    expect(sdk.signOut).toHaveBeenCalledWith(auth);
  });

  it('defaults to the real SDK without touching the network on construction', () => {
    expect(() => new FirebaseIdentityProvider(persistence)).not.toThrow();
    expect(THNDR_FIREBASE_CONFIG.projectId).toBe('thndr-api');
  });
});
