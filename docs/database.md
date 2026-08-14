# Database

PostgreSQL via Prisma. Schema: `apps/api/prisma/schema.prisma`.

## Model map

```
User ──┬── Session
       ├── Workspace (owned)
       └── WorkspaceMember ──┐
                             │
                        Workspace ──┬── InstagramAccount
                                    ├── OAuthState
                                    ├── Workflow ──┬── WorkflowCondition
                                    │              ├── WorkflowAction
                                    │              └── WorkflowExecution
                                    │                      └── WorkflowExecutionAction
                                    ├── WebhookEvent ──────────┘
                                    └── AuditLog
```

## Two rules that shape everything

**1. Tenant-owned rows carry `workspaceId` directly**, even when it is reachable
through a parent. `WorkflowExecution` could find its workspace via its workflow;
storing it means the tenant filter is always a column on the table being
queried, rather than a join condition that can be dropped.

**2. Idempotency is enforced by unique constraints, not application logic.** A
read-then-write check races. A constraint does not.

## Indexes

Chosen against actual query patterns, not applied blindly.

| Table | Index | Query it serves |
| --- | --- | --- |
| `workflows` | `(workspaceId, status, triggerType)` | The engine's hot path, run on every inbound event. Column order matters: `workspaceId` is most selective and always supplied. |
| `workflows` | `(workspaceId, updatedAt)` | The list page |
| `workflow_executions` | `(workspaceId, startedAt)` | Activity feed, newest first |
| `workflow_executions` | `(workspaceId, status, startedAt)` | Dashboard aggregates grouped by status over a window |
| `workflow_executions` | `(workflowId, startedAt)` | A single workflow's history |
| `webhook_events` | `(processed, createdAt)` | The worker's claim query |
| `webhook_events` | `(workspaceId, createdAt)` | Activity page |
| `workspace_members` | `(workspaceId, userId)` unique | The membership check on every authenticated request |
| `workspace_members` | `(userId)` | The switcher's list |
| `sessions` | `tokenHash` unique | Session lookup — one indexed read per request |
| `instagram_accounts` | `instagramUserId` unique | Webhook routing, and the one-owner guarantee |

## Unique constraints that carry meaning

```prisma
WebhookEvent.eventId                          @unique
WorkflowExecution(workflowId, webhookEventId) @unique
InstagramAccount.instagramUserId              @unique
OAuthState.state                              @unique
Session.tokenHash                             @unique
```

**`WebhookEvent.eventId`** is the product's idempotency guarantee. It is derived
only from Meta's own identifiers, so a redelivery produces the same string and
conflicts on insert.

**`(workflowId, webhookEventId)`** means one event can produce at most one
execution per workflow, even if it slipped past the event-level dedupe.
`webhookEventId` is nullable, so manual test runs are unconstrained — which is
the intent.

**`instagramUserId` globally unique**, not per workspace. Meta delivers keyed
only by this id; two workspaces holding the same account would make an inbound
comment ambiguous and execute it twice. Connecting an already-claimed account
returns `CONFLICT`.

## Deletion behaviour

| Relation | On delete | Why |
| --- | --- | --- |
| `Workspace` → children | Cascade | Deleting a workspace should leave nothing behind |
| `WebhookEvent` → `WorkflowExecution` | SetNull | Trimming old events must not erase execution history |
| `WorkflowAction` → `WorkflowExecutionAction` | SetNull | Deleting an action must not erase the record that it ran. `actionType` is snapshotted on the result row for the same reason |
| `User` → `AuditLog` | SetNull | The audit trail outlives the account |

`InstagramAccount` is never deleted on disconnect. The row is marked
`DISCONNECTED` and the token overwritten with a tombstone — the credential is
genuinely gone, but "which account did this run against?" stays answerable.

## Sensitive columns

| Column | Handling |
| --- | --- |
| `User.passwordHash` | Argon2id. Read only inside `auth.service`; excluded from `SAFE_USER_SELECT` |
| `Session.tokenHash` | SHA-256 of the cookie value, never the value |
| `InstagramAccount.accessTokenEncrypted` | AES-256-GCM, `v1:iv:tag:data`. Excluded from `SAFE_ACCOUNT_SELECT` |
| `AuditLog.metadata` | Passed through a redactor on write |

`SAFE_ACCOUNT_SELECT` is the enforcement point for "the token never leaves the
server". Every read feeding an API response uses it. This is the direct answer
to a defect found in the audited prior system, where a dashboard query used
`select("*")` and shipped a channel's webhook secret to the browser.

## Enums

Declared twice — in `schema.prisma` and in `packages/contracts/src/enums.ts`.
Prisma cannot import Zod, and the browser cannot import Prisma, so the
duplication is unavoidable. The drift is not: `enum-parity.test.ts` compares all
twelve and fails the build on a mismatch.

## Transactions

Used where partial success would produce a state with no screen for it:

- **Signup** — user + workspace + membership + session + audit. A committed user
  with no workspace has nowhere to land.
- **Workflow create/update** — workflow + conditions + actions. A workflow whose
  conditions committed but whose actions did not would be live, match events,
  and do nothing.

`recordInTransaction` is used where the audit row must share the write's fate;
plain `record` is fire-and-forget elsewhere, because an audit failure must not
roll back the action it describes.

## Migrations

```bash
npm run db:migrate    # development: create + apply
npm run db:deploy     # production: apply only
npm run db:reset      # drop, re-migrate, re-seed
```

In production, migrations run as a one-shot compose service rather than in the
API's entrypoint — with several replicas, an entrypoint migration means every
replica racing to migrate the same database on every deploy.

## Seed

`npm run db:seed` creates a demo account, a workspace, a mock Instagram
connection, two workflows, and thirty days of execution history with realistic
volume variation and a low non-zero failure rate.

It is idempotent, and it refuses to run against a non-local `DATABASE_URL` or
with `NODE_ENV=production` — fabricated executions in a real workspace would
corrupt the one thing this product is supposed to be trustworthy about.
