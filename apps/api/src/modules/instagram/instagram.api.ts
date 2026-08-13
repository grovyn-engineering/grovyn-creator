import { setTimeout as delay } from "node:timers/promises";
import { logger } from "../../config/logger.js";
import { AppError } from "../../http/errors.js";
import {
  GRAPH_ERROR,
  INSTAGRAM_GRAPH_HOST,
  REVOKED_SUBCODES,
  type GraphErrorBody,
} from "./instagram.types.js";

/**
 * The one place the product talks to Meta over HTTP.
 *
 * Nothing else in the codebase calls `fetch` against a Meta host. Centralising
 * it is what makes timeouts, retries, rate-limit backoff, error classification
 * and the "never log a token" rule properties of the system rather than things
 * each call site has to remember.
 */

/** A Meta failure, classified into what the caller should do about it. */
export type MetaFailureKind =
  /** The token is dead. The account must be reconnected; retrying cannot help. */
  | "TOKEN_INVALID"
  /** The user revoked access from Meta's side. */
  | "TOKEN_REVOKED"
  /** Throttled. Retrying later will work. */
  | "RATE_LIMITED"
  /** The app lacks a permission. A configuration or App Review problem. */
  | "PERMISSION_DENIED"
  /** Malformed request or a resource that does not exist. Retrying cannot help. */
  | "BAD_REQUEST"
  /** Network failure, timeout, or a 5xx. Retrying may help. */
  | "TRANSIENT"
  | "UNKNOWN";

export class MetaApiError extends Error {
  constructor(
    public readonly kind: MetaFailureKind,
    message: string,
    public readonly details: {
      status?: number;
      code?: number;
      subcode?: number;
      traceId?: string;
      endpoint?: string;
    } = {}
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** True when another attempt has any chance of a different outcome. */
  get retryable(): boolean {
    return this.kind === "TRANSIENT" || this.kind === "RATE_LIMITED";
  }

  /**
   * Converts to the error the client sees. The Meta message is deliberately
   * dropped — it names internal fields and object ids — and travels in
   * `internal` for the log instead.
   */
  toAppError(): AppError {
    switch (this.kind) {
      case "TOKEN_INVALID":
      case "TOKEN_REVOKED":
        return AppError.accountUnavailable(
          "The Instagram connection is no longer valid. Reconnect the account to continue."
        );
      case "RATE_LIMITED":
        return AppError.upstream(
          "Instagram is rate limiting this account. Try again shortly.",
          this
        );
      case "PERMISSION_DENIED":
        return AppError.accountUnavailable(
          "This app does not have permission to do that on the connected account."
        );
      case "BAD_REQUEST":
        return AppError.upstream("Instagram rejected that request.", this);
      default:
        return AppError.upstream("Instagram could not be reached. Try again shortly.", this);
    }
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Base for exponential backoff between retries. */
const BACKOFF_BASE_MS = 500;

export interface MetaRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Appended as query parameters. `access_token` is added separately. */
  params?: Record<string, string | number | undefined>;
  /** Sent as form-encoded, which is what Meta's OAuth endpoints expect. */
  form?: Record<string, string>;
  accessToken?: string;
  /** Overrides the Graph host — OAuth lives on different hosts. */
  host?: string;
  /** Per-call attempt cap. Token exchange sets this to 1: the code is single-use. */
  maxAttempts?: number;
}

/**
 * Performs a request against Meta, with retries, and normalises every failure
 * mode into a `MetaApiError`.
 */
export async function metaRequest<T>(path: string, options: MetaRequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    params = {},
    form,
    accessToken,
    host = INSTAGRAM_GRAPH_HOST,
    maxAttempts = MAX_ATTEMPTS,
  } = options;

  const url = new URL(path.startsWith("/") ? path : `/${path}`, host);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: MetaApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // A fresh controller per attempt: an aborted signal stays aborted, so
    // reusing one would make every retry fail instantly.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });

      const text = await response.text();

      if (response.ok) {
        // Meta occasionally answers with a bare `true` rather than JSON.
        return (text ? (JSON.parse(text) as T) : (undefined as T));
      }

      lastError = classify(response.status, text, `${method} ${url.pathname}`, response);

      if (!lastError.retryable || attempt === maxAttempts) throw lastError;

      // The URL is logged without its query string: `access_token` is a query
      // parameter on some Meta endpoints, and logging the full URL would put a
      // live token in the log.
      logger.warn(
        {
          attempt,
          kind: lastError.kind,
          status: response.status,
          endpoint: `${method} ${url.pathname}`,
        },
        "meta request failed; retrying"
      );

      await delay(backoffFor(lastError, attempt, response));
    } catch (error) {
      clearTimeout(timer);

      if (error instanceof MetaApiError) throw error;

      // AbortError from the timeout, a DNS failure, a socket reset — all
      // transient by nature.
      const kind: MetaFailureKind = "TRANSIENT";
      lastError = new MetaApiError(
        kind,
        error instanceof Error && error.name === "AbortError"
          ? `Request to Meta timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Network failure calling Meta: ${String(error)}`,
        { endpoint: `${method} ${url.pathname}` }
      );

      if (attempt === maxAttempts) throw lastError;
      await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new MetaApiError("UNKNOWN", "Meta request failed");
}

/**
 * Honours `Retry-After` when Meta sends one, since it knows how long the
 * window has left; otherwise exponential backoff with jitter. Jitter matters
 * because a rate limit tends to hit every worker at once, and identical
 * backoff would have them all retry in lockstep.
 */
function backoffFor(error: MetaApiError, attempt: number, response: Response): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  }

  const base = error.kind === "RATE_LIMITED" ? BACKOFF_BASE_MS * 4 : BACKOFF_BASE_MS;
  const exponential = base * 2 ** (attempt - 1);
  return exponential + Math.random() * 250;
}

function classify(
  status: number,
  body: string,
  endpoint: string,
  response: Response
): MetaApiError {
  let parsed: GraphErrorBody | null = null;
  try {
    parsed = JSON.parse(body) as GraphErrorBody;
  } catch {
    // Meta returned HTML — usually an edge/proxy error page rather than the API.
  }

  const meta = parsed?.error;
  const code = meta?.code;
  const subcode = meta?.error_subcode;
  const details = { status, code, subcode, traceId: meta?.fbtrace_id, endpoint };

  // Header-based throttling signal, present even on some 200s.
  const throttled = response.headers.get("x-app-usage") ?? response.headers.get("x-business-use-case-usage");

  if (code === GRAPH_ERROR.INVALID_TOKEN) {
    const revoked = subcode !== undefined && REVOKED_SUBCODES.has(subcode);
    return new MetaApiError(
      revoked ? "TOKEN_REVOKED" : "TOKEN_INVALID",
      meta?.message ?? "Access token is not valid",
      details
    );
  }

  if (
    code === GRAPH_ERROR.APP_RATE_LIMIT ||
    code === GRAPH_ERROR.USER_RATE_LIMIT ||
    code === GRAPH_ERROR.PAGE_RATE_LIMIT ||
    code === GRAPH_ERROR.CALL_LIMIT ||
    status === 429
  ) {
    return new MetaApiError("RATE_LIMITED", meta?.message ?? "Rate limited by Meta", {
      ...details,
      ...(throttled ? { usage: throttled } : {}),
    } as MetaApiError["details"]);
  }

  if (code === GRAPH_ERROR.PERMISSION_DENIED || status === 403) {
    return new MetaApiError("PERMISSION_DENIED", meta?.message ?? "Permission denied", details);
  }

  if (status >= 500) {
    return new MetaApiError("TRANSIENT", meta?.message ?? `Meta returned ${status}`, details);
  }

  if (status >= 400) {
    return new MetaApiError("BAD_REQUEST", meta?.message ?? `Meta returned ${status}`, details);
  }

  return new MetaApiError("UNKNOWN", meta?.message ?? `Unexpected response ${status}`, details);
}
