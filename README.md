# SocialPilot

Instagram automation with a record of everything it did.

Connect an Instagram professional account, describe what should happen when
someone comments or sends a message, and SocialPilot handles it — keeping a
per-run record of what matched, what ran, and what Instagram said back.

> **Name notice.** "SocialPilot" is an existing commercial social-media product
> (socialpilot.co). This project is unrelated and the name carries a real
> trademark collision if published. Branding is confined to
> `apps/web/components/brand/logo.tsx` and a handful of strings, so renaming is
> a contained change.

---

## What it does

```
Sign up  →  Workspace created  →  Connect Instagram  →  Build a workflow
                                                              │
                          Instagram webhook ──────────────────┘
                                    │
              persist → dedupe → queue → engine → actions → execution record
                                                                 │
                                                            Dashboard
```

A workflow is one sentence:

```
WHEN   someone comments on a post
IF     the comment contains "price"
THEN   reply publicly, and send them a DM
```

## Architecture

```
┌──────────────┐        REST + httpOnly cookie        ┌──────────────┐
│   Next.js    │ ───────────────────────────────────> │   Express    │
│  React 19    │ <─────────────────────────────────── │  TypeScript  │
└──────────────┘                                      └───────┬──────┘
                                                              │
                          ┌───────────────────┬───────────────┴───────────┐
                          ▼                   ▼                           ▼
                   Authentication      Workflow engine              Instagram
                    (Argon2id,        (pure evaluation,          (provider iface,
                  server sessions)     Prisma-only I/O)          real + dev mock)
                          │                   │                           │
                          └───────────────────┼───────────────────────────┘
                                              ▼
                                    ┌──────────────────┐
                                    │    PostgreSQL    │
                                    │      Prisma      │
                                    └────────┬─────────┘
                                             │
                                    ┌──────────────────┐        ┌──────────────┐
                                    │  Redis / BullMQ  │ <───── │   Webhooks   │
                                    │     (worker)     │        │     Meta     │
                                    └──────────────────┘        └──────────────┘
```

Layering is strict: **route → controller → service → repository → database**.
Controllers hold no business rules; services make no Meta calls directly; the
workflow engine imports no React and no Express.

### Repository layout

```
socialpilot/
├── apps/
│   ├── api/                   Express + Prisma
│   │   ├── prisma/            schema, migrations, seed
│   │   └── src/
│   │       ├── config/        env validation, logger, prisma client
│   │       ├── engine/        workflow engine — pure, no framework
│   │       ├── http/          error types, response envelope, validation
│   │       ├── jobs/          BullMQ queue and processors
│   │       ├── middleware/    auth, workspace scoping, rate limits, errors
│   │       └── modules/       auth · workspaces · instagram · workflows
│   │                          dashboard · webhooks · events · audit
│   └── web/                   Next.js App Router
│       ├── app/(auth)/        login, signup
│       ├── app/(app)/         dashboard, workflows, instagram, activity, settings
│       ├── components/        ui primitives, layout, feature components
│       └── features/          data hooks per domain
└── packages/
    └── contracts/             shared Zod schemas — the single source of truth
```

`@socialpilot/contracts` is validated identically on both sides. The client copy
exists to save a round trip; the server is always the real gate.

---

## Requirements

- **Node.js 20.11+** (22 LTS recommended)
- **Docker** — for Postgres and Redis
- **npm 10+**

A Meta developer account is *not* required for local development; see
[Instagram in development](#instagram-in-development).

---

## Getting started

```bash
git clone <repo> socialpilot && cd socialpilot
npm install
```

Create `.env` from the template and generate the two secrets:

```bash
cp .env.example .env
node -e "const c=require('crypto');console.log('SESSION_SECRET='+c.randomBytes(32).toString('base64'));console.log('TOKEN_ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
```

Paste both into `.env`, then copy it where the API reads it:

```bash
cp .env apps/api/.env
```

Start Postgres and Redis, migrate, and seed:

```bash
npm run infra:up
npm run db:migrate
npm run db:seed
```

Run both apps:

```bash
npm run dev
```

- Web — http://localhost:3000
- API — http://localhost:5000

Sign in with the seeded account:

```
demo@socialpilot.local  /  demo-password
```

The seed creates a workspace with a connected mock Instagram account, two
workflows, and thirty days of execution history, so the dashboard renders real
shapes rather than empty states.

### Background worker

With `REDIS_URL` set, webhook events go through BullMQ and need a worker:

```bash
npm run dev:worker
```

Without `REDIS_URL` the API processes events in-process instead — fine for local
work, refused in production, because in-process work does not survive a restart.

---

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | — | `development` \| `test` \| `production` |
| `FRONTEND_URL` | yes | Exact CORS origin. Must be https in production. |
| `BACKEND_URL` | yes | `META_REDIRECT_URI` must start with this. |
| `DATABASE_URL` | yes | Postgres connection string |
| `REDIS_URL` | in production | Omit locally to process inline |
| `SESSION_SECRET` | yes | ≥32 bytes, base64 |
| `TOKEN_ENCRYPTION_KEY` | yes | **exactly** 32 bytes, base64 (AES-256-GCM) |
| `META_APP_ID` | in production | Instagram App ID, not the Facebook one |
| `META_APP_SECRET` | in production | Server-only, never reaches the browser |
| `META_REDIRECT_URI` | in production | Must match the App Dashboard exactly |
| `META_WEBHOOK_VERIFY_TOKEN` | in production | Any string you choose |
| `META_GRAPH_VERSION` | — | Pinned, default `v23.0` |
| `USE_MOCK_INSTAGRAM` | — | Forced `false` in production |
| `TRUST_PROXY` | — | Proxy hop count; `1` behind one load balancer |
| `NEXT_PUBLIC_API_URL` | yes | Inlined at **build** time, not read at runtime |

The API validates all of this at startup and refuses to boot with a readable
report rather than failing later on the first request that needs a value.

Rotating `TOKEN_ENCRYPTION_KEY` invalidates every stored token; all accounts
must reconnect.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web together |
| `npm run dev:worker` | Background worker |
| `npm run build` | Build contracts, API, and web |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm run lint` | ESLint across all workspaces |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Seed development data |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run infra:up` / `infra:down` | Postgres + Redis |

---

## Instagram in development

`USE_MOCK_INSTAGRAM=true` (the default) serves a local stand-in for Meta, so the
whole product — OAuth, webhooks, workflow execution — works with no Meta
account, no App Review, and no public HTTPS callback.

The mock serves its own clearly-labelled consent screen and redirects into the
**real** callback, so state verification, code exchange, token encryption, the
account upsert, and audit logging all run exactly as in production. Only the far
end is simulated, and actions are logged instead of sent.

Two independent guards prevent it reaching production: `env.ts` refuses to boot
with it enabled when `NODE_ENV=production`, and `getProvider()` throws if the
mock is ever constructed there.

To exercise the full pipeline, post a webhook yourself:

```bash
curl -X POST http://localhost:5000/api/webhooks/instagram -H 'Content-Type: application/json' -d '{"object":"instagram","entry":[{"id":"mock_seed_account","time":1754000000,"changes":[{"field":"comments","value":{"id":"c_1","text":"what is the price?","from":{"id":"u1","username":"curious_buyer"},"media":{"id":"p1"}}}]}]}'
```

Post it twice — the second is deduplicated.

Real Meta setup, permissions, App Review, and the production checklist are in
**[docs/meta-instagram.md](docs/meta-instagram.md)**.

---

## Security

- **Passwords** — Argon2id at OWASP's baseline (19 MiB, t=2, p=1), parameters
  stated explicitly so a dependency's changing defaults cannot silently alter
  the cost of every hash ever written.
- **Sessions** — server-side and revocable, stored as SHA-256 hashes so a
  database leak yields no usable cookies. `httpOnly`, so XSS cannot exfiltrate
  one. Changing a password revokes every other session.
- **Login** — Argon2 runs on a decoy hash when the email does not exist, so
  response time does not reveal which emails are registered.
- **Access tokens** — AES-256-GCM at rest with a fresh IV per encryption and an
  authenticated tag. One module decrypts; no response schema can carry
  ciphertext.
- **Multi-tenancy** — `workspaceId` is a required positional argument on every
  workflow repository method, so a query that is not tenant-scoped cannot be
  expressed. A workspace the caller cannot see returns 404, not 403, so list
  endpoints are not enumeration oracles.
- **OAuth** — `state` is 256 bits, stored server-side, and consumed atomically
  (`updateMany` with `consumedAt: null` in the predicate), so a replay cannot
  win a race. Post-OAuth redirects are allowlisted against the frontend origin.
- **Webhooks** — HMAC-SHA256 over the raw bytes; verify tokens and signatures
  compared in constant time.
- **Logging** — redaction is configured centrally, because the dangerous case is
  the error object nobody thought about.

---

## Testing

```bash
npm test          # unit
npm run test:e2e  # end-to-end
```

Unit tests cover condition evaluation, variable interpolation, event
normalization, token encryption, and Prisma/Zod enum parity.

Two are worth singling out:

- The interpolation suite caught a live defect where `{{constructor}}` in a
  workflow message resolved through the prototype chain to
  `function Object() { [native code] }` and would have been posted verbatim as a
  public Instagram reply.
- The parity suite fails the build if an enum member is added to
  `schema.prisma` or the Zod contracts but not the other — otherwise the
  mismatch surfaces much later as a value the database accepts and the API
  rejects.

---

## Production

```bash
docker compose up --build
```

Runs Postgres, Redis, migrations (as a one-shot service, so replicas do not race
to migrate), the API, a worker, and the web app.

Full deployment notes are in **[docs/deployment.md](docs/deployment.md)**.

---

## Documentation

| | |
| --- | --- |
| [architecture.md](docs/architecture.md) | Layering, request lifecycle, why things are where they are |
| [database.md](docs/database.md) | Schema, indexes, and the reasoning behind each |
| [workflow-engine.md](docs/workflow-engine.md) | Matching, evaluation, execution, idempotency |
| [meta-instagram.md](docs/meta-instagram.md) | OAuth, scopes, webhooks, App Review, known gaps |
| [api.md](docs/api.md) | Endpoints, envelope, error codes |
| [deployment.md](docs/deployment.md) | Production topology and checklist |
| [zernflow-feature-audit.md](docs/zernflow-feature-audit.md) | What was reused from the prior system, and what was not |

---

## Scope

V1 is **Instagram only**, deliberately. The provider interface is narrow with
one real implementation plus a dev mock — sized for a second platform later,
rather than built for six now. Every table is already platform-keyed, so adding
one is an enum member and a provider, not a migration across the schema.
