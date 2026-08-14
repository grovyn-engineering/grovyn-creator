/**
 * Transport shapes. Mirrors `backend/src/contracts/api.ts`.
 * See ./README.md for why this is duplicated and how drift is caught.
 */

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "ACCOUNT_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Field-level detail, so a server rejection renders against the right input. */
export interface FieldError {
  /** Dot path into the submitted object, e.g. `conditions.0.value`. */
  path: string;
  message: string;
}

export interface ApiError {
  code: ErrorCode;
  /** Safe to show verbatim. Never a stack trace or a secret. */
  message: string;
  fields?: FieldError[];
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Cursor pagination. The cursor is opaque — build one and it will be rejected.
 */
export interface Paginated<T> {
  items: T[];
  /** Null on the last page. */
  nextCursor: string | null;
}

export interface PaginationQuery {
  cursor?: string;
  limit?: number;
}
