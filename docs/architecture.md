# Architecture

## Layering

```
Route  →  Controller  →  Service  →  Repository  →  Database
```

Each layer knows only the one below it.

| Layer | Holds | Never holds |
| --- | --- | --- |
| Route | Path, method, middleware chain, schema binding | Logic |
| Controller | HTTP ↔ service translation, cookies | Business rules, queries |
| Service | Business rules, transactions, audit, orchestration | SQL, HTTP concerns |
| Repository | Queries, selects, indexes | Policy |

The rules that hold in practice: no database query in a controller, no Meta call
outside `modules/instagram`, no business logic in a React component, and the
workflow engine imports neither React nor Express.

## Request lifecycle

```
request
  → requestContext        assigns/propagates X-Request-Id
  → httpLogger            access log, health checks excluded
  → helmet, cors          one exact allowed origin
  → json (128kb cap)      captures rawBody for /api/webhooks/* only
  → cookieParser
  → attachSession         resolves the session cookie; never rejects
  → apiLimiter
  → requireAuth           the gate
  → requireWorkspace      resolves + proves membership; sets req.workspace
  → validateBody/Query    Zod; replaces the raw value with the parsed one
  → controller → service → repository
  → errorHandler          the only place an error becomes a response
```

`attachSession` and `requireAuth` are separate so routes that behave differently
for signed-in users without demanding a session can still see one.

`req.workspace` existing *is* the proof that authorization ran — handlers read
`req.workspace.id` and pass it into repositories that require it.

## Contracts, and the three copies of them

`backend/src/contracts/` is authoritative. Two other copies exist, and neither
duplication is avoidable:

| Copy | Why it cannot import the others |
| --- | --- |
| `backend/prisma/schema.prisma` | Prisma cannot import Zod |
| `frontend/types/` | Importing the backend would make the frontend's build depend on it, which is exactly the coupling this architecture removes |

The duplication is unavoidable; the *drift* is not. Two tests close it:

- `enum-parity.test.ts` — Prisma ↔ backend contracts.
- `contract-drift.test.ts` — backend contracts ↔ `frontend/types/`. It reads the
  frontend's files **as text** rather than importing them, so the check exists
  only at test time and nothing survives into either build. If `frontend/` is
  absent, it skips.

Without these, a member added on one side surfaces much later as a value the
database accepts and the API rejects, or one the API returns and the UI cannot
render.

Frontend validation exists for latency. The server is always the real gate, and
`validateBody` replaces the raw value with the parsed one so a handler
downstream cannot accidentally read an unvalidated field.

## Multi-tenancy

Three mechanisms, deliberately overlapping:

1. **Denormalized `workspaceId`.** Every tenant-owned row carries it directly,
   even when it could be reached through a parent. `WorkflowExecution` could
   find its workspace via its workflow; storing it means the tenant filter is
   always a column on the table being queried, not a condition in a join that
   can be dropped.

2. **Required arguments.** Every workflow repository method takes `workspaceId`
   as a required first argument. A query that is not tenant-scoped cannot be
   expressed. This replaces the prior system's approach, where the filter was an
   `.eq()` that had to be remembered and was documented with a comment warning
   what happened if you forgot.

3. **Scoped writes.** Updates and deletes use `updateMany`/`deleteMany` with
   `workspaceId` in the predicate, so the check and the write are one statement
   and a foreign id affects zero rows rather than being checked separately.

A resource in another workspace returns 404, not 403 — 403 confirms the id
exists.

## The provider boundary

```
engine / services
        │  depends only on SocialProvider
        ▼
┌───────────────────┐
│  SocialProvider   │
├───────────────────┤
│ InstagramProvider │  ← real Meta Graph API
│ MockInstagram…    │  ← development only, two independent guards
└───────────────────┘
```

The interface exposes what V1 actually does, not everything Instagram can. A
wider interface would be speculative and would have to be implemented twice,
including by the mock.

All Meta HTTP goes through `metaRequest` in `instagram.api.ts` — one place for
timeouts, retries, rate-limit backoff, error classification, and the rule that a
token never appears in a log. Nothing else in the codebase fetches a Meta host.

## Asynchronous processing

```
Meta → POST /api/webhooks/instagram
         verify signature (raw bytes)
         200 EVENT_RECEIVED          ← before any slow work
         normalize → persist (unique eventId) → enqueue
                                        │
                              BullMQ ───┘
                                        │
                                   worker process
                                        │
                                    engine → Meta
```

The webhook answers before doing anything slow because Meta treats a slow
response as a failed delivery, and enough of them disable the subscription
entirely.

The worker is a separate process so a burst of webhook processing cannot starve
HTTP requests of event-loop time, and so the two scale independently.

Without `REDIS_URL` the API processes inline instead. That keeps the whole
product usable on a laptop with only Postgres running, and production refuses to
boot without Redis because in-process work does not survive a restart.

## Frontend

Next.js App Router. Two route groups: `(auth)` signed-out, `(app)` signed-in.

`proxy.ts` (Next 16's rename of `middleware.ts`) checks only for the *presence*
of the session cookie. It cannot verify a server-side session without a database
round trip on every navigation. It is not the security boundary — the API
validates on every request — it just means a signed-out visitor sees the login
page rather than a shell that empties itself a moment later.

Data flows through TanStack Query. Every workspace-scoped key carries the
workspace id, which is what makes switching correct rather than merely fast: a
bare `["dashboard"]` key would render one tenant's numbers under another's name
for a frame.

Metrics are computed by the API, never in React.

## Notable decisions

**Server-side sessions, not JWTs.** Logging out and revoking every session after
a password change both have to be immediate, and a stateless token cannot be
withdrawn before it expires. Stored as SHA-256 hashes so a database leak yields
no usable cookies.

**Argon2id, not bcrypt.** Memory-hard, so GPU attackers gain far less. OWASP
baseline parameters stated explicitly rather than inherited from library
defaults that could change.

**`instagramUserId` globally unique.** Meta delivers webhooks keyed only by this
id. If two workspaces connected the same account, an inbound comment would have
no single owner and would execute twice.

**Idempotency by constraint, not by check.** Read-then-write races —
redeliveries arrive in bursts and two workers can both see "not present".
