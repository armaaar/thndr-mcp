import type { ApprovalStatus, DeviceApprovalRequest } from '../../domain/identity/device-approval.js';
import type { RefreshCredential } from '../../domain/identity/refresh-credential.js';
import type { ThndrSession } from '../../domain/identity/thndr-session.js';

/** Result of exchanging an approved request, or of refreshing. */
export interface IssuedAccess {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Cookies the server set on this response (may be empty on refresh if not rotated). */
  cookies: Record<string, string>;
  refreshExpiresAt: Date | null;
}

/** Thndr's own authentication endpoints (auth-service + x.thndr.app/api/auth). */
export interface ThndrAuthGateway {
  /** Mails a 6-digit code; returns the verification id. */
  sendEmailCode(email: string): Promise<string>;
  /** Verifies the code; returns a Firebase custom token. */
  verifyEmailCode(verificationId: string, code: string): Promise<string>;
  createApprovalRequest(firebaseIdToken: string): Promise<DeviceApprovalRequest>;
  getApprovalStatus(request: DeviceApprovalRequest, firebaseIdToken: string): Promise<ApprovalStatus>;
  exchangeApproval(request: DeviceApprovalRequest, firebaseIdToken: string): Promise<IssuedAccess>;
  /** Throws `SessionExpiredError` when the refresh credential is no longer accepted. */
  refreshAccess(refresh: RefreshCredential): Promise<IssuedAccess>;
  logout(refresh: RefreshCredential): Promise<void>;
}

/** Firebase identity (ADR 0010: implemented with the official SDK). */
export interface IdentityProvider {
  signInWithCustomToken(customToken: string): Promise<void>;
  /** Current Firebase ID token (refreshed by the SDK when needed), or null if not signed in. */
  getIdToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

export interface SessionRepository {
  load(): Promise<ThndrSession | null>;
  save(session: ThndrSession): Promise<void>;
  clear(): Promise<void>;
}
