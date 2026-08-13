import type { ErrorCode, FieldError } from "@socialpilot/contracts";
import { STATUS_BY_ERROR_CODE } from "@socialpilot/contracts";

/**
 * The one error type the application throws deliberately.
 *
 * Everything a client is allowed to learn lives in `message`; everything else
 * goes in `internal`, which the error handler logs and never serialises. That
 * split is what makes "no stack traces in production" a property of the type
 * rather than a rule people have to remember at each throw site.
 */
export class AppError extends Error {
  public readonly status: number;

  constructor(
    public readonly code: ErrorCode,
    /** Shown to the user verbatim. Must not contain provider or system detail. */
    message: string,
    public readonly options: {
      fields?: FieldError[];
      /** Logged, never returned. Original provider errors belong here. */
      internal?: unknown;
      /** Value for a Retry-After header, in seconds. */
      retryAfter?: number;
    } = {}
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS_BY_ERROR_CODE[code];
    Error.captureStackTrace?.(this, AppError);
  }

  static validation(message: string, fields?: FieldError[]): AppError {
    return new AppError("VALIDATION_ERROR", message, { fields });
  }

  static unauthenticated(message = "Sign in to continue."): AppError {
    return new AppError("UNAUTHENTICATED", message);
  }

  static forbidden(message = "You do not have access to this workspace."): AppError {
    return new AppError("FORBIDDEN", message);
  }

  /**
   * Used for genuinely missing rows *and* for rows in another tenant's
   * workspace. Returning 403 for the latter would confirm the id exists,
   * turning any list endpoint into an enumeration oracle.
   */
  static notFound(what = "That resource"): AppError {
    return new AppError("NOT_FOUND", `${what} could not be found.`);
  }

  static conflict(message: string): AppError {
    return new AppError("CONFLICT", message);
  }

  static upstream(message: string, internal?: unknown): AppError {
    return new AppError("UPSTREAM_ERROR", message, { internal });
  }

  static accountUnavailable(message: string): AppError {
    return new AppError("ACCOUNT_UNAVAILABLE", message);
  }

  static internal(message = "Something went wrong on our end.", internal?: unknown): AppError {
    return new AppError("INTERNAL_ERROR", message, { internal });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
