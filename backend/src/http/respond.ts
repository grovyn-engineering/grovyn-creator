import type { Response } from "express";
import type { ApiErrorResponse, ApiSuccessResponse } from "../contracts/index.js";

/**
 * The only two functions that write a response body. Handlers never call
 * `res.json` directly, so the `{ success, data }` / `{ success, error }`
 * envelope is structurally guaranteed rather than conventional.
 */

export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccessResponse<T> = { success: true, data };
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

/** 204 carries no body, so it does not take the envelope. */
export function noContent(res: Response): void {
  res.status(204).end();
}

export function fail(res: Response, status: number, error: ApiErrorResponse["error"]): void {
  const body: ApiErrorResponse = { success: false, error };
  res.status(status).json(body);
}
