# Instagram SaaS

Instagram automation with a record of everything it did.

Connect an Instagram professional account, describe what should happen when
someone comments or sends a message, and the system handles it — keeping a
per-run record of what matched, what ran, and what Instagram said back.

> **Name notice.** The product is currently branded "SocialPilot", which is an
> existing commercial product (socialpilot.co). This project is unrelated and
> the name carries a real trademark collision if published. Branding is confined
> to `frontend/components/brand/logo.tsx` and a handful of strings.

---

## Architecture

Two independent applications. Neither build depends on the other's source tree;
either can be deployed on its own.

```
                          USER
                            │
                            ▼
                   ┌─────────────────┐
                   │    frontend/    │   Next.js · React · Tailwind · shadcn
                   │  presentation   │
                   └────────┬────────┘
                            │  REST over HTTPS, httpOnly session cookie
                            ▼
                   ┌─────────────────┐
                   │    backend/     │   Node · Express · TypeScript
                   │ all business    │
                   │     logic       │
                   └────────┬────────┘
                            │
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
       Prisma        Workflow engine       Instagram
          │                 │              (Meta Graph)
          ▼                 │                   │
   Supabase Postgres        │                   ▼
                            │              Meta webhooks
                            ▼
                     Redis / BullMQ
                    (optional locally)
```

**The frontend never touches** PostgreSQL, Prisma, Meta access tokens, the app
secret, or the workflow engine. It knows one thing: `NEXT_PUBLIC_API_URL`.

Two rules keep it that way rather than relying on discipline:

- `frontend/eslint.config.mjs` bans imports from `backend/` and `@prisma/*`.
- `backend/src/config/contract-drift.test.ts` fails the build if the frontend's
  copy of an enum drifts from the backend's.

```
instagram-saas/
├── frontend/          Next.js only
│   ├── app/           routes: (auth), dashboard, workflows, instagram, activity, settings
│   ├── components/    ui · layout · dashboard · workflows
│   ├── features/      data hooks per domain
│   ├── lib/api/       the entire view of the backend
│   ├── types/         the frontend's copy of the API contract
│   └── providers/
├── backend/           Node + Express + Prisma
│   ├── prisma/        schema · migrations · seed
│   └── src/
│       ├── config/    env validation · logger · prisma client
│       ├── contracts/ authoritative Zod schemas
│       ├── engine/    workflow engine — no framework, no Meta types
│       ├── modules/   auth · workspaces · instagram · workflows · dashboard · webhooks
│       ├── jobs/      BullMQ queue and processors
│       └── middleware/
├── docs/
└── package.json       orchestration only
```

---

## Requirements

- **Node.js 20.11+** (22 LTS recommended)
- **A Supabase account** — free tier is fine

**Docker is not required.** There is no local database to run.

---

## Setup

```bash
git clone <repo> instagram-saas
cd instagram-saas
npm install
```

`npm install` installs the root tooling and then both applications.

### 1. Create the Supabase database

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Connect → ORMs → Prisma**.
3. Copy **both** connection strings. Prisma needs both, for different reasons —
   this is the step most setups get wrong:

   | | Port | Used by | Why |
   | --- | --- | --- | --- |
   | `DATABASE_URL` | 6543 | the running app | The transaction pooler, so multiple instances don't exhaust Postgres connections |
   | `DIRECT_URL` | 5432 | `prisma migrate` only | PgBouncer doesn't support the prepared statements and advisory locks migrations need |

   Append `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`. Without
   `pgbouncer=true`, Prisma emits prepared statements the pooler rejects with
   *"prepared statement s0 already exists"*.

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Fill in `DATABASE_URL` and `DIRECT_URL`, then generate the two secrets:

```bash
node -e "const c=require('crypto');console.log('SESSION_SECRET='+c.randomBytes(32).toString('base64'));console.log('TOKEN_ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
```

`TOKEN_ENCRYPTION_KEY` must decode to **exactly** 32 bytes — AES-256-GCM takes
a 256-bit key. Rotating it invalidates every stored Instagram token.

### 3. Configure the frontend

```bash
cp frontend/.env.example frontend/.env.local
```

The default (`NEXT_PUBLIC_API_URL=http://localhost:5000`) is correct for local
development. Everything in this file is public — it is inlined into the browser
bundle at build time.

### 4. Create the schema

```bash
cd backend
npx prisma validate
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

Or from the root: `npm run db:migrate && npm run db:seed`.

Verify with `npx prisma studio` — you should see 13 tables with seeded rows.

### 5. Run

```bash
npm run dev
```

| | |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend | http://localhost:5000 |
| Health | http://localhost:5000/api/health |

Sign in with the seeded account:

```
demo@socialpilot.local  /  demo-password
```

The seed creates a workspace with a connected mock Instagram account, two
workflows, and thirty days of execution history, so the dashboard renders real
shapes rather than empty states.

### Background worker (optional)

Redis is optional. Without `REDIS_URL` the backend processes webhook events
in-process — fine locally, refused in production, because in-process work does
not survive a restart. Use a hosted Redis (Upstash has a free tier); no Docker
needed. With it configured:

```bash
npm run dev:worker
```

---

## Commands

All runnable from the root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Both apps, colour-prefixed |
| `npm run dev:backend` / `dev:frontend` | One at a time |
| `npm run dev:worker` | Background worker |
| `npm run build` | Build both |
| `npm run typecheck` | Both |
| `npm run lint` | Both |
| `npm test` | Backend unit tests |
| `npm run test:integration` | Needs a database |
| `npm run test:e2e` | Playwright, needs both apps running |
| `npm run db:validate` | Check schema.prisma |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Seed development data |
| `npm run db:studio` | Prisma Studio |

---

## How it fits together

**Frontend → backend.** Components never call `fetch`. They call
`api.dashboard.getOverview()` from `frontend/lib/api/`, which is the only place
an endpoint path or response shape is written down.

**Authentication.** Signup and login set an `httpOnly`, `SameSite=Lax` session
cookie. JavaScript cannot read it, so an XSS bug cannot exfiltrate a session.
Nothing is stored in `localStorage`. Sessions live server-side and are
revocable — changing a password ends every other session immediately, which a
stateless JWT cannot do.

**Workspace scoping.** Every workspace-scoped request resolves a workspace from
a header, query, cookie, or session — and validates *every one of those* against
membership before use. A claim that doesn't hold up falls through to the user's
default rather than erroring.

**Instagram OAuth.** Entirely server-side. The frontend asks for an authorize
URL and navigates there; only the backend can mint the CSRF `state` and holds
the app secret. Tokens are encrypted with AES-256-GCM before storage and are
excluded from every response by construction.

**Webhooks.** `POST /api/webhooks/instagram` verifies an HMAC-SHA256 signature
over the raw bytes, answers 200 immediately, then persists and enqueues. Meta
treats a slow response as a failed delivery. Idempotency is a unique constraint
on a deterministic event id, not a read-then-write check.

**Workflow engine.** Entirely backend. The frontend configures workflows; the
backend runs them.

---

## Testing

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Unit tests cover condition evaluation, variable interpolation, event
normalization, token encryption, Prisma↔Zod enum parity, and backend↔frontend
contract drift.

Integration and E2E need a database:

```bash
npm run test:integration   # auth, tenant isolation, webhook→execution
npm run test:e2e           # the full journey in a browser
```

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

## Troubleshooting

**`npm run dev` fails immediately with exit code 1, or 4294967295 on Windows** —
a previous run's servers are still holding ports 3000/5000. It happens whenever
`npm run dev` is stopped in a way that doesn't let it clean up: a closed
terminal, a hard stop from an editor, a crash. Because the root script uses
`--kill-others-on-fail`, one stuck port takes both apps down, and the exit codes
say nothing useful.

```bash
npm run ports:free
```

Then `npm run dev` again. If the error mentions `EADDRINUSE` you have the same
problem under a clearer name.

**Backend exits with code 78** — configuration. The report names each bad
variable. Nothing else is wrong.

**`prepared statement "s0" already exists`** — `DATABASE_URL` is the pooled
connection without `?pgbouncer=true`.

**Migrations hang or fail on advisory locks** — `prisma migrate` is running
against the pooled URL. It needs `DIRECT_URL` (port 5432).

**CORS errors in the browser** — `FRONTEND_URL` in `backend/.env` must be the
exact origin, scheme and port included. The backend allows one origin
deliberately: a reflected origin with credentials would let any site drive the
API with a user's session.

**Frontend says "Could not reach the server"** — the backend isn't running, or
`NEXT_PUBLIC_API_URL` points somewhere else. Note that changing it requires a
rebuild, not a restart.
