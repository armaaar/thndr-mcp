/** Errors raised by the application layer and adapters, independent of transport. */
export abstract class ApplicationError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** No usable session: the user must (re-)login. */
export class NotAuthenticatedError extends ApplicationError {
  readonly code = 'NOT_AUTHENTICATED';

  constructor(message = 'Not logged in to Thndr. Run the login_start tool (or `thndr-mcp login`) first.') {
    super(message);
  }
}

/** The broker API answered with an error or an unexpected payload. */
export class UpstreamError extends ApplicationError {
  readonly code = 'UPSTREAM_ERROR';

  constructor(
    message: string,
    readonly status?: number,
    readonly upstreamCode?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** A requested resource does not exist. */
export class NotFoundError extends ApplicationError {
  readonly code = 'NOT_FOUND';
}

/** A feature is disabled by configuration (e.g. trading, ADR 0006). */
export class FeatureDisabledError extends ApplicationError {
  readonly code = 'FEATURE_DISABLED';
}

/** The refresh credential was rejected: a new device approval is needed. */
export class SessionExpiredError extends ApplicationError {
  readonly code = 'SESSION_EXPIRED';

  constructor(
    message = 'Your Thndr session expired. Call login_request_approval (or login_start) and approve on your phone.',
  ) {
    super(message);
  }
}
