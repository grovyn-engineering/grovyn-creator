import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { FieldError } from "@socialpilot/contracts";
import { AppError } from "./errors.js";

/**
 * Schema validation as middleware.
 *
 * Two things make this worth having over an inline `schema.parse(req.body)`:
 * the parsed value replaces the raw one, so a handler downstream cannot
 * accidentally read an unvalidated field; and Zod issues are converted to the
 * `fields` array the client renders next to form inputs, so backend validation
 * produces the same UI as frontend validation instead of a generic banner.
 *
 * Frontend validation exists for latency, not for trust. Every route below is
 * the real gate.
 */

export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

type Source = "body" | "query" | "params";

function validate(source: Source, schema: z.ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(
        AppError.validation(
          source === "body"
            ? "Some fields need attention."
            : "That request was not valid.",
          toFieldErrors(result.error)
        )
      );
      return;
    }

    // Express 5 makes `req.query` a getter, so it cannot be reassigned the way
    // it could in Express 4. The parsed value is stashed on the request instead
    // and read through `validated()` below.
    if (source === "query") {
      (req as RequestWithValidated).validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }

    next();
  };
}

interface RequestWithValidated extends Request {
  validatedQuery?: unknown;
}

export const validateBody = (schema: z.ZodTypeAny): RequestHandler => validate("body", schema);
export const validateQuery = (schema: z.ZodTypeAny): RequestHandler => validate("query", schema);
export const validateParams = (schema: z.ZodTypeAny): RequestHandler => validate("params", schema);

/**
 * Reads the query validated by `validateQuery`. Typed by the caller, which is
 * sound only because the matching schema ran first — routes always pair them.
 */
export function validatedQuery<T>(req: Request): T {
  return (req as RequestWithValidated).validatedQuery as T;
}
