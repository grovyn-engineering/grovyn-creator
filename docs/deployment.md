# Deployment

## Topology

```
                    ┌──────────────┐
   HTTPS ─────────> │ reverse proxy│  terminates TLS
                    └──────┬───────┘
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐      ┌──────────────┐
        │  web (3000)  │      │  api (5000)  │
        │   Next.js    │      │   Express    │
        └──────────────┘      └──────┬───────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌──────────────┐  ┌────────────┐  ┌──────────────┐
            │  PostgreSQL  │  │   Redis    │  │   worker(s)  │
            └──────────────┘  └────────────┘  └──────────────┘
```

Put both apps behind **one domain** — `app.example.com` and
`app.example.com/api`, or two subdomains of the same registrable domain. The
session cookie is `SameSite=Lax`, which requires same-site. Genuinely
cross-site deployment would need `SameSite=None; Secure` plus a CSRF token.

## Quick start

```bash
cp .env.example .env      # fill in every secret
docker compose up --build
```

This runs Postgres, Redis, migrations as a one-shot service, the API, a worker,
and the web app.

## Before going live

**Secrets**

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('base64'))"
```

Generate `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` separately. The latter must
decode to **exactly** 32 bytes — AES-256-GCM takes a 256-bit key.

Rotating `TOKEN_ENCRYPTION_KEY` invalidates every stored access token and forces
every customer to reconnect. Treat it as permanent; back it up separately from
the database, since together they are the plaintext.

**Configuration**

- `NODE_ENV=production`
- `USE_MOCK_INSTAGRAM=false` — the API refuses to boot otherwise
- `FRONTEND_URL` must be `https://` — the API refuses to boot otherwise
- `REDIS_URL` set — required in production
- `TRUST_PROXY` = number of proxy hops (`1` behind one load balancer). Set
  explicitly, never `true`, which trusts any `X-Forwarded-For` a client sends
- `META_REDIRECT_URI` must start with `BACKEND_URL` and match the App Dashboard
  byte for byte

Startup validation checks all of this and exits `78` with a readable report
rather than booting into a broken state.

**Meta** — business verification, App Review for the two management
permissions, privacy policy and data deletion callbacks, app switched to Live.
See [meta-instagram.md](meta-instagram.md).

## Build-time vs runtime configuration

`NEXT_PUBLIC_API_URL` is **inlined into the client bundle at build time**. It is
a Docker build argument, not a runtime environment variable — a different
environment needs a different image. This is a framework constraint, not a
choice.

Everything the API reads is runtime configuration and can change with a restart.

## Health checks

| Endpoint | Use |
| --- | --- |
| `GET /health` | Liveness — process is up. No database. |
| `GET /api/health` | Readiness — touches Postgres, 503 if unreachable |

Point liveness at `/health` and readiness at `/api/health`. Using the readiness
probe for liveness would restart a healthy process during a brief database blip,
turning a partial outage into a restart loop.

## Scaling

**API** — stateless; scale horizontally. One caveat: the rate limiter uses an
in-memory store, so limits are per process. With N replicas the effective limit
is N× the configured value. For strict limits, swap in
`rate-limit-redis` in `middleware/rate-limit.ts`.

**Worker** — scale by webhook volume. Concurrency is 5 per worker with a 30/s
limiter, deliberately modest: each job makes outbound Meta calls, and Meta rate
limits per account, so running dozens in parallel converts throughput into 429s
and retries.

**Postgres** — the dashboard's aggregates are the heaviest reads. If they become
slow before vertical scaling runs out, materialize daily rollups rather than
adding indexes to `workflow_executions`, which is write-heavy.

## Zero-downtime deploys

1. Apply migrations first, as a separate step. Make them backward compatible —
   the old code must survive the new schema for the length of the rollout.
2. Roll the API and worker.
3. Roll the web app.

Additive changes only during a rolling deploy. Dropping a column requires two
releases: stop reading it, then drop it.

`SIGTERM` triggers graceful shutdown — stop accepting connections, drain
in-flight requests, close the pool, with a 15s cap. The worker finishes its
current job first, so an execution is never abandoned mid-way through its
outbound calls and left `RUNNING` forever. Give containers at least 20s to
terminate.

## Backups

Back up Postgres. Redis holds only in-flight jobs; losing it loses queued work,
but the `WebhookEvent` rows survive and can be re-enqueued.

Test restores. An untested backup is a hypothesis.

## Observability

Structured JSON logs on stdout. Every request carries `X-Request-Id`, echoed in
the response header, so a user reporting "it said something went wrong" can be
matched to an exact log line.

Redaction is configured centrally in `config/logger.ts` — access tokens, cookies
and signatures never reach a log, including inside an error object logged whole.

Worth alerting on: `webhook_events` where `processed = false` and `createdAt`
older than a few minutes (worker stalled), executions with status `FAILED`
trending up, `InstagramAccount` rows leaving `ACTIVE`, and 5xx rate.

## Troubleshooting

**API exits immediately with code 78** — configuration. The report names each
bad variable.

**Webhook events never arrive** — check, in order: the account is subscribed
(`POST /me/subscribed_apps` runs at connect but is non-fatal, so check the logs
for a subscription failure); the callback URL is public HTTPS with a valid
certificate; the app-level field subscriptions include `comments`/`messages`;
`META_APP_SECRET` is correct, since a wrong one makes every delivery fail
signature verification with a 403.

**Events arrive but nothing runs** — the Activity page shows `executionCount`
per event. Zero against a received comment means the event arrived and no
workflow matched, which points at conditions rather than the connection. Check
the workflow is `ACTIVE` and open a `SKIPPED` execution to see which condition
rejected it.

**"Instagram connection is no longer valid"** — the token expired or was
revoked. Long-lived tokens last 60 days and are refreshed automatically when
under 7 days remain, but a workspace dormant for 60 days expires permanently and
must reconnect.

**CORS failures in the browser** — `FRONTEND_URL` must be the exact origin,
scheme and port included. The API allows one origin, deliberately: a reflected
origin with `credentials: true` would let any site drive the API with the user's
cookies.
