# API reference

Base URL: `${BACKEND_URL}` — `http://localhost:5000` in development.

## Response envelope

Every response is one of two shapes. Clients branch on `success` alone, never on
the HTTP status, so a proxy rewriting a status cannot make an error look like a
payload.

```json
{ "success": true, "data": { } }
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields need attention.",
    "fields": [{ "path": "conditions.0.value", "message": "Enter a value to match." }]
  }
}
```

`message` is always safe to show a user verbatim. It never contains a stack
trace, a provider payload, or a secret — those go to the log. `fields` appears
only on validation failures and is what lets a server-side rejection render
against the exact form input that caused it.

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body, query, or params failed schema validation |
| `UNAUTHENTICATED` | 401 | No session, or expired |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Missing, **or** in another workspace |
| `CONFLICT` | 409 | Duplicate email, account already connected |
| `ACCOUNT_UNAVAILABLE` | 409 | Instagram account unusable |
| `RATE_LIMITED` | 429 | Too many requests |
| `UPSTREAM_ERROR` | 502 | Meta failed in a retryable way |
| `CONFIGURATION_ERROR` | 500 | Server misconfigured; never names the variable |
| `INTERNAL_ERROR` | 500 | Unhandled |

A resource in another tenant's workspace returns **404, not 403**. Returning 403
would confirm the id exists, turning any endpoint into an enumeration oracle.

## Authentication

Session cookie, `httpOnly`, `SameSite=Lax`, `Secure` in production. Browser
clients send `credentials: "include"`; there is no bearer token, and nothing is
stored in `localStorage`.

## Workspace scoping

Every workspace-scoped request resolves a workspace before the handler runs.
Resolution order, most to least explicit:

1. `X-Workspace-Id` header — what the frontend always sends
2. `?workspaceId=`
3. the `sp_workspace` cookie
4. the session's `activeWorkspaceId`
5. the caller's first workspace

**Every one of these is an untrusted claim, including the session's own record.**
Each is validated against membership before use; one that does not hold up falls
through to the next rather than failing, so a stale cookie degrades to "your
default workspace" instead of an error the user cannot act on.

## Pagination

Cursor-based wherever a list grows without bound. Executions and events are
append-heavy and written in bursts, so an offset walk both skips and repeats
rows while the user is reading.

```
GET /api/workflows/executions?limit=25&cursor=<opaque>
→ { "items": [...], "nextCursor": "..." | null }
```

The cursor is `<ISO timestamp>|<id>` in base64url. Both parts are needed:
executions frequently share a millisecond, so a timestamp alone breaks at the
page boundary. Treat it as opaque.

---

## Endpoints

### Auth

| | | |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Creates user, workspace, membership, and session in one transaction |
| `POST` | `/api/auth/login` | Rate limited, 10 failures / 15 min / IP |
| `POST` | `/api/auth/logout` | Always succeeds; clears cookies even with a dead session |
| `GET` | `/api/auth/me` | **200 with `user: null` when signed out**, not 401 |
| `PATCH` | `/api/auth/profile` | Name only |
| `POST` | `/api/auth/password` | Revokes every other session |

`/api/auth/me` deliberately returns 200 when signed out. Being logged out is an
ordinary state, not an error, and a 401 would make every client log a console
error on the login page.

### Workspaces

| | | |
| --- | --- | --- |
| `GET` | `/api/workspaces` | All memberships, with a connected-account flag each |
| `POST` | `/api/workspaces` | Creates and switches to it |
| `POST` | `/api/workspaces/switch` | Re-checks membership, updates the session |
| `GET` | `/api/workspaces/current` | The resolved workspace |
| `PATCH` | `/api/workspaces/current` | Rename; requires ADMIN or above |
| `GET` | `/api/workspaces/current/members` | |

### Dashboard

| | | |
| --- | --- | --- |
| `GET` | `/api/dashboard?range=7d\|30d\|90d` | Summary, trend, and per-workflow performance together |
| `GET` | `/api/dashboard/activity` | Recent executions, bounded |

Summary, trend, and performance travel in one response because the dashboard
renders them as one view; splitting them would mean three round trips and three
loading states for a single screen.

Every figure is aggregated in SQL. Dry runs are excluded from all of them.

### Instagram

| | | |
| --- | --- | --- |
| `GET` | `/api/instagram` | Connection state. `isConnected` is computed server-side |
| `GET` | `/api/instagram/connect` | Returns `{ authorizeUrl }` — not a 302 |
| `GET` | `/api/instagram/callback` | **Public.** Meta's redirect target; always 302s to the app |
| `GET` | `/api/instagram/media` | Recent posts for the condition picker |
| `DELETE` | `/api/instagram/:id` | Disconnect; tombstones the token, keeps history |

`/connect` returns a URL rather than redirecting because an XHR cannot follow a
redirect to a third-party consent screen — the frontend navigates the top window
itself.

`/callback` is unauthenticated by necessity: the browser arrives from
instagram.com and the session cookie may or may not ride along. Trust comes
entirely from the `state` parameter, which was minted against a real session and
is consumed atomically.

### Workflows

| | | |
| --- | --- | --- |
| `GET` | `/api/workflows?status=&search=` | With condition, action, and execution counts |
| `POST` | `/api/workflows` | Transactional with children; created as `DRAFT` |
| `GET` | `/api/workflows/:id` | |
| `PATCH` | `/api/workflows/:id` | Replaces conditions and actions wholesale |
| `DELETE` | `/api/workflows/:id` | |
| `POST` | `/api/workflows/:id/enable` | 409 if no Instagram account is connected |
| `POST` | `/api/workflows/:id/disable` | |
| `POST` | `/api/workflows/:id/test` | `DRY_RUN` through the real engine |
| `GET` | `/api/workflows/:id/executions` | Paginated |
| `GET` | `/api/workflows/executions` | Across all workflows |
| `GET` | `/api/workflows/executions/:executionId` | |

New workflows start `DRAFT`. One that immediately began acting on a live account
is not a surprise anyone wants.

Enabling is refused without a connected account: a workflow marked `ACTIVE` with
nothing feeding it would sit in the UI looking live and never run.

Update replaces children rather than diffing them. Reconciling two ordered
collections by identity is a large surface for partial-write bugs, and the
builder always submits the complete list.

### Events

| | | |
| --- | --- | --- |
| `GET` | `/api/events?eventType=&limit=&cursor=` | Received events with per-event execution counts |

Returns the **normalized** form only. Meta's raw payload is retained in the
database for diagnostics and is never an API response.

`executionCount: 0` against a received comment is the diagnosis: the event
arrived and nothing matched, which points at conditions rather than at the
connection.

### Webhooks

| | | |
| --- | --- | --- |
| `GET` | `/api/webhooks/instagram` | Verification handshake; echoes `hub.challenge` as plain text |
| `POST` | `/api/webhooks/instagram` | Event delivery |

Both public — Meta cannot present a session. Authenticity is the verify token on
GET and an HMAC-SHA256 signature on POST, both compared in constant time.

**No rate limiter is mounted here.** Meta bursts hard after any outage, and a
429 is recorded as a failed delivery that counts toward disabling the
subscription. The handler is bounded and fast instead: verify, acknowledge, then
persist and enqueue.

### Health

| | | |
| --- | --- | --- |
| `GET` | `/health` | Liveness. No database, no rate limit |
| `GET` | `/api/health` | Readiness. Touches Postgres; 503 if unreachable |

A process that is up but cannot reach the database should be pulled from a load
balancer rather than served traffic — which is why these are separate.

## Rate limits

| Scope | Window | Limit | Key |
| --- | --- | --- | --- |
| Auth endpoints | 15 min | 10 **failures** | IP (IPv6 normalized to /64) |
| Everything else | 1 min | 300 | user id, falling back to IP |
| Webhooks | — | none | see above |

Only failures count against the auth limit — signing in on several devices
should not lock you out with your own successes. IPv6 is normalized to a /64
prefix; without that, an attacker with a routed block gets a fresh bucket per
request.

The store is in-memory, so limits are **per process**. Running several replicas
requires the Redis store; see deployment.md.
