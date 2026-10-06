/** Supplies a valid bearer token for authenticated Thndr API calls, refreshing it when needed. */
export interface AccessTokenProvider {
  /** Returns a currently valid full-access token or throws `NotAuthenticatedError`. */
  getAccessToken(): Promise<string>;
  /** Called when the API rejected the token (401/403) so the next call forces a refresh. */
  invalidate(): void;
}
