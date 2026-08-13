import type { ApiResponse, ErrorCode, FieldError } from "@socialpilot/contracts";

/**
 * The single place the browser talks to the API.
 *
 * Everything goes through `request`, so credentials, the workspace header, the
 * response envelope, and error shaping are handled once rather than at each
 * call site. Components never see a `fetch`, a status code, or an envelope —
 * they get data or a typed error.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/**
 * A failed API call, carrying the machine-readable code the UI branches on.
 *
 * `fields` is what lets a server-side validation failure render against the
 * exact form input that caused it, so backend validation produces the same UI
 * as client-side validation rather than a generic banner. That matters because
 * the backend is the real gate — the client's copy of the schema exists only to
 * save a round trip.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly fields?: FieldError[]
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** True when retrying the identical request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === "RATE_LIMITED" || this.status === 0;
  }

  get isAuthError(): boolean {
    return this.code === "UNAUTHENTICATED";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /**
   * Scopes the request to a workspace. Sent as a header rather than baked into
   * every path, so switching workspaces does not rewrite every URL in the app —
   * and the server still validates it against membership regardless.
   */
  workspaceId?: string | null;
  signal?: AbortSignal;
  /** Query parameters. Undefined values are dropped rather than serialised. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, workspaceId, signal, query } = options;

  const url = new URL(path.startsWith("/") ? path : `/${path}`, API_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // The session is an httpOnly cookie, so it has to be sent explicitly on
      // a cross-origin request. This is why the API's CORS config names one
      // exact origin — `credentials: include` with a reflected origin would let
      // any site drive the API with the user's session.
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    // Network-level failure: offline, DNS, CORS rejection, or an aborted
    // request. Status 0 marks it retryable without inventing an HTTP code.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError(
      "INTERNAL_ERROR",
      "Could not reach the server. Check your connection and try again.",
      0
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  let payload: ApiResponse<T> | null = null;
  try {
    payload = text ? (JSON.parse(text) as ApiResponse<T>) : null;
  } catch {
    // A non-JSON body means something upstream answered instead of the API —
    // a proxy error page, most often. Surfaced as a generic failure rather
    // than rendering HTML into an error message.
    throw new ApiClientError(
      "INTERNAL_ERROR",
      "The server returned an unexpected response.",
      response.status
    );
  }

  // Branching on `success` rather than on `response.ok`, so a proxy that
  // rewrote the status cannot make an error look like a payload.
  if (!payload || payload.success !== true) {
    const error = payload && payload.success === false ? payload.error : null;
    throw new ApiClientError(
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? "Something went wrong.",
      response.status,
      error?.fields
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

/**
 * Maps an API error onto form field errors for React Hook Form.
 *
 * Returns null when the error is not field-level, so a caller can fall back to
 * a form-wide message rather than silently swallowing, say, a 409.
 */
export function toFormErrors(error: unknown): Record<string, { message: string }> | null {
  if (!(error instanceof ApiClientError) || !error.fields?.length) return null;

  const out: Record<string, { message: string }> = {};
  for (const field of error.fields) {
    if (field.path) out[field.path] = { message: field.message };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A user-safe message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
