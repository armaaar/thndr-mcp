import { SessionExpiredError, UpstreamError } from '../../application/errors';
import type { Clock } from '../../application/ports/clock';
import type { IssuedAccess, ThndrAuthGateway } from '../../application/ports/identity';
import type { HttpResponse, ThndrHttpClient } from '../../data-sources/thndr/http-client';
import { decodeJwtPayload, parseSetCookie, parseTimestamp } from '../../data-sources/thndr/wire';
import { DEFAULT_ACCESS_TOKEN_TTL_MS } from '../../domain/identity/access-token';
import {
  type ApprovalStatus,
  DeviceApprovalRequest,
  parseApprovalStatus,
} from '../../domain/identity/device-approval';
import type { RefreshCredential } from '../../domain/identity/refresh-credential';

/** Scopes requested by ThndrX web (docs/api/auth.md §2.1). */
export const THNDRX_SCOPES = [
  'notifications:read',
  'notifications:write',
  'assets:read',
  'assets:write',
  'analysis:read',
  'charts:read',
  'watchlist:read',
  'watchlist:write',
  'market_depth:read',
  'user:read',
  'user:write',
  'feed:read',
  'post:read',
  'post:write',
  'kyc_challenge:read',
  'kyc_challenge:write',
  'files:write',
  'document:write',
  'subscription:read',
  'subscription:write',
  'market_simulator:read',
  'market_simulator:write',
  'order:read',
  'order:write',
  'investor:read',
  'investor:write',
  'market_egypt:read',
  'market_egypt:write',
  'funding:read',
  'funding:write',
] as const;

const SESSION_ENDED_TYPES = new Set([
  'INVALID_REFRESH_TOKEN',
  'MISSING_REFRESH_TOKEN',
  'EXPIRED_REFRESH_TOKEN',
]);

interface TokenRequestDto {
  id?: string;
  request_secret?: string;
  human_id?: string | number;
  status?: string;
}

interface AuthTokenDto {
  auth_token?: string;
  auth_token_expires_at?: unknown;
  refresh_token_expires_at?: unknown;
}

/**
 * Adapter for Thndr's authentication endpoints.
 * `prod` targets https://prod.thndr.app, `web` targets https://x.thndr.app/api (Next.js routes).
 */
export class HttpThndrAuthGateway implements ThndrAuthGateway {
  constructor(
    private readonly prod: ThndrHttpClient,
    private readonly web: ThndrHttpClient,
    private readonly clock: Clock,
    private readonly platform: 'thndrx_web' | 'thndrx_mobile' = 'thndrx_web',
  ) {}

  async sendEmailCode(email: string): Promise<string> {
    const data = await this.prod.post<{ id?: string }>(
      '/auth-service/v2/users/email-code',
      { email },
      { auth: 'none' },
    );
    return required(data?.id, 'verification id');
  }

  async verifyEmailCode(verificationId: string, code: string): Promise<string> {
    const data = await this.prod.post<{ firebase_auth_token?: string }>(
      '/auth-service/v2/users/login',
      { id: verificationId, code },
      { auth: 'none' },
    );
    return required(data?.firebase_auth_token, 'firebase_auth_token');
  }

  async createApprovalRequest(firebaseIdToken: string): Promise<DeviceApprovalRequest> {
    const data = await this.prod.post<TokenRequestDto>(
      '/auth-service/tokens/request',
      { data: { scopes: THNDRX_SCOPES }, credentials: { firebase_token: firebaseIdToken } },
      { auth: 'none' },
    );
    return DeviceApprovalRequest.of({
      id: required(data?.id, 'token request id'),
      secret: required(data?.request_secret, 'request_secret'),
      humanId: data.human_id === undefined ? '' : String(data.human_id),
      createdAt: this.clock.now(),
    });
  }

  async getApprovalStatus(request: DeviceApprovalRequest, firebaseIdToken: string): Promise<ApprovalStatus> {
    const data = await this.prod.post<TokenRequestDto>(
      `/auth-service/tokens/request/${encodeURIComponent(request.id)}/status`,
      { data: { request_secret: request.secret }, credentials: { firebase_token: firebaseIdToken } },
      { auth: 'none' },
    );
    return parseApprovalStatus(data?.status);
  }

  async exchangeApproval(request: DeviceApprovalRequest, firebaseIdToken: string): Promise<IssuedAccess> {
    const response = await this.web.exchange<AuthTokenDto>('POST', '/auth/login', {
      auth: 'none',
      body: {
        request_id: request.id,
        request_secret: request.secret,
        firebase_token: firebaseIdToken,
        platform: this.platform,
      },
    });
    const issued = this.toIssuedAccess(response);
    if (Object.keys(issued.cookies).length === 0) {
      throw new UpstreamError('Thndr login succeeded but no refresh cookie was set');
    }
    return issued;
  }

  async refreshAccess(refresh: RefreshCredential): Promise<IssuedAccess> {
    try {
      const response = await this.web.exchange<AuthTokenDto>('POST', '/auth/refresh', {
        auth: 'none',
        headers: { cookie: refresh.toCookieHeader() },
      });
      return this.toIssuedAccess(response);
    } catch (error) {
      if (
        error instanceof UpstreamError &&
        ((error.upstreamCode && SESSION_ENDED_TYPES.has(error.upstreamCode)) || error.status === 401)
      ) {
        throw new SessionExpiredError();
      }
      throw error;
    }
  }

  async logout(refresh: RefreshCredential): Promise<void> {
    await this.web.delete('/auth/logout', { auth: 'none', headers: { cookie: refresh.toCookieHeader() } });
  }

  private toIssuedAccess(response: HttpResponse<AuthTokenDto>): IssuedAccess {
    const now = this.clock.now();
    const accessToken = required(response.data?.auth_token, 'auth_token');
    const cookies: Record<string, string> = {};
    let cookieExpiry: Date | null = null;
    for (const header of response.headers.getSetCookie()) {
      const cookie = parseSetCookie(header, now);
      if (!cookie || cookie.deleted) continue;
      cookies[cookie.name] = cookie.value;
      if (cookie.expiresAt && (!cookieExpiry || cookie.expiresAt > cookieExpiry))
        cookieExpiry = cookie.expiresAt;
    }
    const jwtExp = parseTimestamp(decodeJwtPayload(accessToken)?.exp);
    return {
      accessToken,
      accessTokenExpiresAt:
        parseTimestamp(response.data.auth_token_expires_at) ??
        jwtExp ??
        new Date(now.getTime() + DEFAULT_ACCESS_TOKEN_TTL_MS),
      cookies,
      refreshExpiresAt: parseTimestamp(response.data.refresh_token_expires_at) ?? cookieExpiry,
    };
  }
}

function required<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null || value === '') {
    throw new UpstreamError(`Unexpected Thndr response: missing ${label}`);
  }
  return value;
}
