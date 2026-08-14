import type { Request } from "express";
import { AppError } from "./errors.js";

/**
 * Reads a required path parameter.
 *
 * Express 5 types a param as `string | string[]` because a route pattern can
 * legitimately capture repeats. None of this API's routes do, but the type is
 * honest and casting it away would hide the one case where a crafted URL
 * really does produce an array — which would otherwise be passed to Prisma as
 * an array and produce a confusing query error rather than a 400.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];

  if (typeof value === "string" && value.length > 0) return value;

  throw AppError.validation(`A ${name} is required.`);
}
