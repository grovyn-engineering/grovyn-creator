import { z } from "zod";

/**
 * Every response the API produces is one of two shapes. Clients branch on
 * `success` alone and never on the HTTP status, so a transport-level oddity
 * (a proxy rewriting a 500, say) cannot be mistaken for a payload.
 */

export const errorCodeSchema = z.enum([
  /** Request body, query, or params failed schema validation. 400. */
  "VALIDATION_ERROR",
  /** No session, or the session is expired/invalid. 401. */
  "UNAUTHENTICATED",
  /** Authenticated, but not permitted to touch this resource. 403. */
  "FORBIDDEN",
  /** Resource does not exist, or exists in a workspace the caller cannot see. 404. */
  "NOT_FOUND",
  /** The request is valid but conflicts with current state (duplicate email, etc). 409. */
  "CONFLICT",
  /** Too many requests. 429. */
  "RATE_LIMITED",
  /** A downstream provider (Meta) failed in a way the caller may retry. 502. */
  "UPSTREAM_ERROR",
  /** The connected Instagram account cannot currently be used. 409. */
  "ACCOUNT_UNAVAILABLE",
  /** The server is misconfigured. Never leaks which variable. 500. */
  "CONFIGURATION_ERROR",
  /** Anything unhandled. 500. */
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** HTTP status for each code, so handlers never pick one by hand. */
export const STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ACCOUNT_UNAVAILABLE: 409,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  CONFIGURATION_ERROR: 500,
  INTERNAL_ERROR: 500,
};

/**
 * Field-level validation detail. Deliberately the only place the error
 * envelope carries structured extra data — everything else is a message,
 * which keeps the client's error rendering to two cases.
 */
export const fieldErrorSchema = z.object({
  /** Dot path into the submitted object, e.g. `conditions.0.value`. */
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  /** Safe to show a user verbatim. Never contains a stack trace or a secret. */
  message: z.string(),
  fields: z.array(fieldErrorSchema).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/** `{ success: true, data: T }` for a given payload schema. */
export function apiSuccess<T extends z.ZodTypeAny>(data: T) {
  return z.object({ success: z.literal(true), data });
}

export type ApiSuccessResponse<T> = { success: true; data: T };
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ── Pagination ───────────────────────────────────────────────────────────

/**
 * Cursor pagination everywhere a list can grow without bound (executions,
 * events, audit log). Offset pagination is not offered: these tables are
 * append-heavy and an offset walk both skips and repeats rows under writes.
 */
export const paginationQuerySchema = z.object({
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    /** Null when this is the last page. */
    nextCursor: z.string().nullable(),
  });
}

export type Paginated<T> = { items: T[]; nextCursor: string | null };

// ── Primitives ───────────────────────────────────────────────────────────

/** Every id in the system is a cuid2 from Prisma. */
export const idSchema = z.string().min(1).max(64);

/** Dates cross the wire as ISO 8601 strings, never as epoch numbers. */
export const isoDateSchema = z.string().datetime();
