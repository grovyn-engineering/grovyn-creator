import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { ApiError } from "@socialpilot/contracts";
import { AppError, isAppError } from "../http/errors.js";
import { toFieldErrors } from "../http/validate.js";
import { fail } from "../http/respond.js";
import { logger } from "../config/logger.js";
import { isProduction } from "../config/env.js";

/**
 * The single place an unhandled error becomes a response.
 *
 * The invariant it enforces: an error the application did not deliberately
 * construct never reaches the client. Anything that is not an `AppError` is
 * logged in full and answered with a generic INTERNAL_ERROR, because a raw
 * message from Prisma or a driver routinely contains table names, column
 * names, and occasionally fragments of the query's parameters.
 */

/** Translates the Prisma errors that correspond to a real client mistake. */
function fromPrisma(error: Prisma.PrismaClientKnownRequestError): AppError | null {
  switch (error.code) {
    case "P2002": {
      // Unique constraint. The target names the columns, which is safe to use
      // for a specific message but never to echo back verbatim.
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.map(String) : [];
      if (fields.includes("email")) {
        return AppError.conflict("An account with that email already exists.");
      }
      if (fields.includes("instagramUserId")) {
        return AppError.conflict(
          "That Instagram account is already connected to another workspace."
        );
      }
      if (fields.includes("eventId")) {
        // Idempotency working as designed, surfaced as a conflict for callers
        // that care and swallowed by the webhook path that expects it.
        return AppError.conflict("That event has already been received.");
      }
      return AppError.conflict("That already exists.");
    }
    case "P2025":
      return AppError.notFound();
    case "P2003":
      return AppError.validation("That reference points at something that does not exist.");
    default:
      return null;
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;

  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof z.ZodError) {
    // A schema that ran outside `validate` middleware — a service parsing a
    // provider response, say. Treated as validation so the fields survive.
    appError = AppError.validation("Some fields need attention.", toFieldErrors(err));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    appError = fromPrisma(err) ?? AppError.internal(undefined, err);
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    appError = new AppError(
      "CONFIGURATION_ERROR",
      "The service is temporarily unavailable.",
      { internal: err }
    );
  } else if (err instanceof SyntaxError && "body" in err) {
    // body-parser's malformed-JSON error.
    appError = AppError.validation("The request body was not valid JSON.");
  } else if (isPayloadTooLarge(err)) {
    appError = AppError.validation("That request was too large.");
  } else {
    appError = AppError.internal(undefined, err);
  }

  const logPayload = {
    err: appError.options.internal ?? err,
    code: appError.code,
    status: appError.status,
    method: req.method,
    path: req.originalUrl,
    requestId: res.locals.requestId,
  };

  // 5xx is our fault and is an error; 4xx is the client's and is not, or a
  // scripted probe would fill the error log with noise.
  if (appError.status >= 500) {
    logger.error(logPayload, appError.message);
  } else {
    logger.warn(logPayload, appError.message);
  }

  const body: ApiError = {
    code: appError.code,
    message: appError.message,
    ...(appError.options.fields?.length ? { fields: appError.options.fields } : {}),
  };

  if (appError.options.retryAfter) {
    res.setHeader("Retry-After", String(appError.options.retryAfter));
  }

  // Outside production the internal detail is attached so a developer does not
  // have to switch to the log to see what actually broke. Gated on NODE_ENV
  // rather than a flag, so it cannot be switched on in a deployed environment.
  if (!isProduction && appError.options.internal) {
    (body as ApiError & { debug?: string }).debug = String(
      appError.options.internal instanceof Error
        ? appError.options.internal.stack
        : appError.options.internal
    );
  }

  fail(res, appError.status, body);
};

function isPayloadTooLarge(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type?: string }).type === "entity.too.large"
  );
}

/** Terminal 404 for anything the router did not claim. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  fail(res, 404, { code: "NOT_FOUND", message: "That endpoint does not exist." });
};
