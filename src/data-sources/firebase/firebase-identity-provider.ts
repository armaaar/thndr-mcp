import { type FirebaseApp, initializeApp } from '@firebase/app';
import {
  type Auth,
  getIdToken,
  initializeAuth,
  type Persistence,
  signInWithCustomToken,
  signOut,
} from '@firebase/auth';
import type { IdentityProvider } from '../../application/ports/identity';

/** Public web config of ThndrX's Firebase project (docs/api/auth.md §1). */
export const THNDR_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCUbo98qRd0KJZbFLfNH0n4_v476vp7XFY',
  authDomain: 'thndr-api.firebaseapp.com',
  projectId: 'thndr-api',
  messagingSenderId: '639172574829',
  appId: '1:639172574829:web:fffdf73e598f98d872c964',
} as const;

export interface FirebaseAuthSdk {
  initializeApp: typeof initializeApp;
  initializeAuth: typeof initializeAuth;
  signInWithCustomToken: typeof signInWithCustomToken;
  getIdToken: typeof getIdToken;
  signOut: typeof signOut;
}

const realSdk: FirebaseAuthSdk = {
  initializeApp,
  initializeAuth,
  signInWithCustomToken,
  getIdToken,
  signOut,
};

/** Firebase identity via the official SDK (ADR 0010). */
export class FirebaseIdentityProvider implements IdentityProvider {
  private auth: Auth | null = null;

  constructor(
    private readonly persistence: Persistence,
    private readonly sdk: FirebaseAuthSdk = realSdk,
    private readonly appName = 'thndr-mcp',
  ) {}

  async signInWithCustomToken(customToken: string): Promise<void> {
    await this.sdk.signInWithCustomToken(await this.getAuth(), customToken);
  }

  async getIdToken(): Promise<string | null> {
    const auth = await this.getAuth();
    const user = auth.currentUser;
    return user ? this.sdk.getIdToken(user) : null;
  }

  async signOut(): Promise<void> {
    await this.sdk.signOut(await this.getAuth());
  }

  private async getAuth(): Promise<Auth> {
    if (!this.auth) {
      const app: FirebaseApp = this.sdk.initializeApp(THNDR_FIREBASE_CONFIG, this.appName);
      this.auth = this.sdk.initializeAuth(app, { persistence: this.persistence });
    }
    await this.auth.authStateReady();
    return this.auth;
  }
}
