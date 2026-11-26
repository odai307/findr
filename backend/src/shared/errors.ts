/** Every error the API returns has a stable machine-readable code. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'GOOGLE_NOT_CONFIGURED'
  | 'OAUTH_FAILED'
  | 'INTERNAL';

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  REFRESH_TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 429,
  GOOGLE_NOT_CONFIGURED: 501,
  OAUTH_FAILED: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusByCode[code];
  }
}
