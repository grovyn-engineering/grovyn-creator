# Zernflow Feature Audit

**Audited revision:** `D:\grovyn\zernflow` (Next.js 16 + Supabase/Postgres, RLS-based multi-tenancy)
**Audit date:** 2026-08-13
**Auditor scope:** Only three areas are in scope per the build mandate — Dashboard, Workspace ↔ Dashboard switching, and Workflow → Dashboard data. Everything else in Zernflow (CRM/brands, finance, campaigns, deliverables, approvals, goals, meetings, products, sequences, broadcasts, inbox, content composer, AI provider config, Zernio integration) is explicitly **out of scope and not migrated**.

## Hard restriction (applies to every section below)

Nothing visual is carried over. No colors, fonts, type scale, layout, cards, sidebar, header, buttons, icon choices, spacing scale, page composition, animations, dashboard design, workflow-builder design, landing page, login design, or components. Zernflow is consulted as a **functional and data-modelling reference only**. SocialPilot's visual system, component library, and information architecture are designed from scratch.

Concretely, these Zernflow files were read for behavior and are **not** used as design references:
`components/sidebar.tsx`, `components/header.tsx`, `components/workspace-switcher.tsx`, `app/(overview)/dashboard/dashboard-view.tsx`, `app/(overview)/dashboard/dashboard-side-nav.tsx`, `components/flow-builder/**`, `components/ui/**`, `components/charts/**`.

---

## 1. Dashboard

### Files inspected

| File | Lines | Role |
| --- | --- | --- |
| `app/(overview)/dashboard/page.tsx` | 106 | Server component. Fan-out query batch; passes raw rows to the view. |
| `app/(overview)/dashboard/dashboard-view.tsx` | 968 | Client component. Contains **all** metric derivation inline in React. |
| `app/(overview)/dashboard/today/today-view.tsx` | — | "Today" slice of the same data. |
| `app/api/v1/activity/route.ts` | — | Activity timeline feed. |
| `app/api/v1/analytics/social/route.ts` | — | Social analytics aggregation. |
| `lib/insights.ts` | 296 | Derived-signal helpers (the only real "service layer" for dashboard data). |
| `supabase/migrations/00021_activity_timeline.sql` | — | Activity/event table shape. |
| `supabase/migrations/00023_insights.sql` | — | Insight persistence. |
| `supabase/migrations/00025_performance_indexes.sql` | — | Index tuning driven by the dashboard's query pattern. |

### Data relationships worth preserving

```
workspace
   ├── channels            → "is a platform account connected?" health signal
   ├── analytics_events    → recent activity feed (event_type, created_at)
   ├── comment_logs        → per-comment processing record (also the idempotency key)
   └── flows → triggers    → what automation exists and whether it is live
```

The genuinely reusable insight is the **shape of the dashboard read**: one workspace-scoped parallel fan-out, each query selecting only the columns the view reads, ordered and limited server-side, then reduced into counters and a recent-activity list.

### Business logic being migrated

1. **Workspace-scoped fan-out with column pruning.** `page.tsx:26-28` carries a load-bearing comment: `channels` originally did `select("*")`, which shipped `webhook_secret` to the browser. The lesson — *never select `*` on a table holding secrets for a dashboard read* — is migrated as a hard rule. In SocialPilot the equivalent table is `InstagramAccount` (holds `accessTokenEncrypted`), and the dashboard repository selects an explicit safe column set.
2. **Single batch, not serial batches.** `page.tsx:11-22` folded a second `await Promise.all` into the first. Migrated as: the dashboard service issues one `$transaction([...])` of independent aggregate queries.
3. **Connection health as a first-class metric.** "Has at least one active channel" drives the dashboard's empty/degraded state. Migrated directly as Instagram connection status.
4. **Recent activity = newest N events, ordered `created_at desc`, capped.** Zernflow caps at 20 (`page.tsx:61`). Migrated with the same bounded-feed approach.
5. **Per-entity "last touch" reduction.** `touchpoints` are fetched ordered newest-first and reduced to one row per entity in memory (`page.tsx:44-48`). The pattern is migrated for "last execution per workflow", but implemented as a SQL `DISTINCT ON` instead of an unbounded fetch-and-reduce.

### What is explicitly NOT migrated

- **Metric computation inside React.** `dashboard-view.tsx` is 968 lines and derives every KPI client-side from raw rows. SocialPilot inverts this: aggregation happens in SQL inside `dashboard.repository.ts`, the service composes the DTO, and the React layer renders numbers it does not compute. This is a direct violation-avoidance of the mandate "do not calculate important business metrics solely in React."
- **Unbounded fetches.** Several Zernflow queries (`brands`, `touchpoints`, `tasks`, `invoices`, `expenses`) have no `.limit()`. At scale these are full workspace-table scans shipped to the browser. SocialPilot's dashboard uses `COUNT`/`GROUP BY` aggregates and bounded feeds only.
- **Every finance, CRM, campaign, content, task, and goal metric.** Out of V1 scope entirely — SocialPilot has no such tables.
- **Any dashboard visual, chart, or layout.** New design.

---

## 2. Workspace ↔ Dashboard switching

### Files inspected

| File | Role |
| --- | --- |
| `lib/workspace.ts` (181 lines) | `getWorkspace()` and `getWorkspaceForRoute()` — resolution, caching, auto-provisioning. |
| `lib/actions/workspace.ts` | `switchWorkspace()`, `createWorkspace()` server actions. |
| `app/(overview)/layout.tsx`, `app/(overview)/dashboard/layout.tsx` | "Overview" mode shell. |
| `app/(dashboard)/layout.tsx` (60 lines) | "Workspace" mode shell. |
| `components/workspace-switcher.tsx` (187 lines) | Tenant picker + inline create. |
| `components/header.tsx` (`:44`, `:280`) | The mode toggle between the two shells. |
| `lib/supabase/middleware.ts`, `middleware.ts` | Auth-aware routing/refresh. |

### The behavior being reused

Zernflow has **two distinct top-level product modes** that share one authenticated session, implemented as two Next.js route groups:

```
(overview)/dashboard/…            →  "Dashboard" mode  (cross-cutting overview)
(dashboard)/dashboard/workspace/… →  "Workspace" mode  (operational surface)
```

The conceptually valuable pieces:

1. **Mode is derived from the URL, not from client state.** `header.tsx:44` matches `pathname` against `/dashboard/workspace` to decide which mode is active. Consequence: the mode survives refresh, is deep-linkable, and needs no store. Migrated as-is (the matching rule is rewritten for SocialPilot's own routes).
2. **Tenant selection is a cookie, resolved server-side.** `WORKSPACE_COOKIE = "zernflow_workspace_id"` (`lib/workspace.ts:6`) is read on the server during render, then **validated against membership** before use (`:31-46`). A cookie naming a workspace the user does not belong to falls through rather than being trusted. This validate-before-trust step is the security-critical part and is migrated exactly. SocialPilot renames the cookie and validates the same way.
3. **Graceful fallback chain.** cookie workspace → first membership → auto-provision a default workspace → redirect to login (`:27-119`). Migrated, minus the service-role escape hatch (see below).
4. **Per-request memoization.** `getWorkspace` is wrapped in React `cache()` so a layout and its page share one auth round trip and one membership lookup (`:8-11`, `:121-125`). Migrated conceptually: SocialPilot resolves the workspace once in Express middleware per request and attaches it to the request context, so a request never re-resolves.
5. **Switching does not full-reload.** `handleSwitch` calls a server action then `router.refresh()` (`workspace-switcher.tsx:53-63`), re-rendering server components while preserving the client tree. Migrated as: set the active-workspace cookie, invalidate the TanStack Query cache for workspace-scoped keys, `router.refresh()`. No `window.location` assignment.
6. **Optimistic in-flight state per row.** A `switching` state keyed by workspace id disables the whole list while one switch is pending (`:31`, `:111`). Behavior migrated; the UI is new.

### What is explicitly NOT migrated

- **Auto-provisioning a workspace via a service-role client that bypasses RLS.** `lib/workspace.ts:65-115` falls back to `createServiceClient()` to force workspace creation "without RLS blocks", and re-queries with it to see rows RLS hid. This papers over an authorization problem with an admin credential on a hot render path. SocialPilot creates the default workspace **transactionally at signup**, so the read path never needs elevated privileges and never writes.
- **`redirect("/login")` as the error handler for a failed insert** (`:117-118`). A database failure is surfaced as an auth failure, which is misleading and unloggable. SocialPilot returns a typed error.
- **Supabase auth, RLS policies, server actions, and the `@supabase/ssr` cookie bridge.** SocialPilot is Express + Prisma with its own session layer; tenant isolation is enforced in application middleware, not RLS.
- **Dicebear remote avatars** (`workspace-switcher.tsx:16-18`) — an external network dependency in the nav shell.
- **All switcher and shell visuals.** New design.

---

## 3. Workflow data (User → Workflow → Workflow data → Dashboard)

### Files inspected

| File | Lines | Role |
| --- | --- | --- |
| `lib/flow-engine/engine.ts` | 1285 | Node-graph executor. |
| `lib/flow-engine/types.ts` | 198 | Node/edge/context type surface. |
| `lib/flow-engine/trigger-matcher.ts` | 112 | Inbound message → trigger resolution. |
| `lib/flow-engine/platform-adapter.ts` | 219 | Per-platform send abstraction. |
| `lib/flow-engine/simulator.ts` | 540 | Dry-run execution. |
| `lib/comment-processor.ts` | 327 | Instagram comment → trigger → flow, with idempotency. |
| `lib/comment-processor.test.ts` | — | Matcher unit tests. |
| `lib/zernio-webhook.ts` + `.test.ts` | — | Webhook normalization. |
| `supabase/migrations/00004_comment_automation.sql` | — | `comment_logs` and comment triggers. |
| `supabase/migrations/00012_webhook_events.sql` | — | Webhook event persistence. |
| `supabase/migrations/00010_flow_versions.sql` | — | Flow versioning. |

### Data relationships worth preserving

```
user → workspace_members → workspace
                              ├── channels
                              ├── flows ──── triggers
                              │       └── flow_versions (graph JSON)
                              ├── comment_logs      → dedupe + audit of processed comments
                              ├── webhook_events    → raw inbound event record
                              └── analytics_events  → what the dashboard reads
```

### Business logic being migrated

1. **Tenant pinning on trigger lookup — the single most important finding.** Both `trigger-matcher.ts:31-41` and `comment-processor.ts:60-70` carry the same load-bearing comment: a `channel_id IS NULL` trigger means *workspace-wide, not global*, so the join **must** be pinned with `.eq("flows.workspace_id", workspaceId)` or one tenant's triggers fire on another tenant's channels. SocialPilot inherits this as a structural guarantee rather than a remembered `.eq()`: every workflow query goes through a repository that takes `workspaceId` as a required, non-optional first argument, and the webhook path derives that id from the receiving `InstagramAccount` row.
2. **Idempotency via a unique log row, checked before any side effect.** `comment-processor.ts:106-113` reads `comment_logs` on `(channel_id, platform_comment_id)` and returns `{ skipped: "already_processed" }` before replying or executing. Migrated and strengthened: SocialPilot puts a **unique constraint on `WebhookEvent.eventId`** and relies on the insert conflicting, rather than a read-then-write race. The read-check is kept as a cheap fast path.
3. **Ordered, priority-driven matching with explicit precedence.** `trigger-matcher.ts:45-111` resolves in a fixed order (postback → quick_reply → keyword → welcome → default) with `priority DESC` within a type. V1 only needs comment and message triggers, but the "ordered, first-match-wins, priority-sorted" contract is migrated so more trigger types slot in without rewriting the resolver.
4. **Per-keyword match semantics with a config-level default.** `trigger-matcher.ts:79-89` and `comment-processor.ts:44-50` both support `exact | contains | startsWith` resolved per keyword, falling back to a config default, falling back to `contains`. Both lowercase and trim before comparing. Migrated into SocialPilot's `WorkflowCondition` operator set (`equals`, `contains`, `starts_with`, `ends_with`, `not_contains`) with the same normalize-then-compare discipline and the same extensibility intent.
5. **Optional scoping predicate on a trigger.** `config.postIds` narrows a comment trigger to specific posts (`comment-processor.ts:42`). Migrated as a normal condition on `comment.post_id`, which generalizes it instead of special-casing it.
6. **Structured JSON node config with a discriminator.** `types.ts:35-38` — `ActionNodeData` carries `actionType` as the real discriminator with action-specific fields alongside. Migrated as `WorkflowAction { actionType, configuration: Json }`, with a Zod schema per `actionType` validating `configuration` on write.
7. **`{{variable}}` interpolation in action text.** Referenced throughout (`types.ts:132`, `:138`). Migrated: SocialPilot resolves a typed variable bag from the normalized event.
8. **Fail-closed on unknown authorization state.** `types.ts:180-187` — `isFollower` is `undefined` when unknown, and the documented rule is to treat unknown as "not following". Migrated as a general engine principle: unknown condition inputs evaluate false, never true.
9. **Separating matching from execution.** `matchCommentTrigger` is a pure, synchronously testable function taking `(triggers, comment)` with no I/O (`comment-processor.ts:32-54`), which is exactly why `comment-processor.test.ts` exists. Migrated as a hard architectural rule: SocialPilot's condition evaluator is pure `(conditions, normalizedEvent) => boolean` and unit-tested in isolation from Prisma and Meta.
10. **Skip-side-effects flag for replay paths.** `options.skipPublicReply` (`comment-processor.ts:98-104`) lets a backfill re-run matching without re-posting public replies. Migrated as an execution mode enum on the engine (`LIVE | DRY_RUN`), which also covers the simulator's purpose.
11. **Dry-run simulation as a first-class capability.** `simulator.ts` (540 lines) exists so users can test a flow without live sends. Migrated in reduced form: `DRY_RUN` mode records a `WorkflowExecution` with `SKIPPED` actions instead of calling Meta.

### What is explicitly NOT migrated

- **The node-graph execution model.** `engine.ts` is a 1285-line traversal over an arbitrary `@xyflow/react` node/edge graph with delays, A/B splits, sub-flow jumps and a `flowStack` for resumable "go to flow, return after" semantics (`types.ts:191-197`). This is powerful and genuinely hard to reason about. SocialPilot V1 deliberately uses a **flat, linear `trigger → conditions[] → actions[]` model**, which is what the mandate's WHEN/IF/THEN UX describes and what makes the builder understandable without technical knowledge. The graph model is not required to express V1's use cases, and adopting it would import the complexity budget of a general workflow engine into a product whose V1 does one thing.
- **Node types outside V1:** `delay`, `smart_delay`, `ab_split`, `go_to_flow`, `human_takeover`, `http_request`, `ai_response`, `enroll_sequence`, `subscribe`, `set_field`, `tag`. No corresponding V1 feature, no tables, no UI.
- **The AI response node and any LLM dependency.** Out of scope.
- **`@xyflow/react` canvas builder** and every builder component.
- **The Zernio third-party client** (`lib/zernio-client.ts`, `@zernio/node`). Zernflow does not talk to Meta directly — it proxies through Zernio, and `FlowExecutionContext` carries `lateConversationId` / `lateAccountId` as a result (`types.ts:166-171`). SocialPilot integrates with the Meta Graph API directly, so this indirection and its leaked vocabulary are dropped entirely.
- **Multi-platform adapter surface.** `platform-adapter.ts` abstracts several platforms. V1 is Instagram-only; SocialPilot defines a narrow `SocialProvider` interface with exactly one implementation (plus a dev-only mock), sized for a second platform later rather than built for six now.
- **Flow versioning** (`00010_flow_versions.sql`). Deferred; not a V1 requirement.
- **Supabase RLS as the isolation mechanism.** Replaced by explicit application-layer workspace authorization.

---

## Summary of the migration

| Area | Migrated | Rebuilt / dropped |
| --- | --- | --- |
| Dashboard | Query shape, column pruning, connection-health signal, bounded activity feed, last-touch reduction | Metric computation moved from React to SQL; all non-Instagram metrics dropped; entire UI new |
| Workspace switch | URL-derived mode, cookie tenant selection **validated against membership**, fallback chain, per-request memoization, refresh-not-reload switching | Service-role RLS bypass and render-path writes removed; Supabase auth replaced; entire UI new |
| Workflow data | Tenant-pinned trigger lookup, idempotency-before-side-effects, priority-ordered first-match, per-keyword match semantics, discriminated JSON action config, variable interpolation, fail-closed unknowns, pure testable matcher, dry-run mode | Node-graph engine replaced with flat trigger/conditions/actions; Zernio proxy removed for direct Meta integration; out-of-scope node types dropped |

### Findings carried forward as invariants

Three defects-in-waiting found in Zernflow are encoded as structural rules in SocialPilot rather than as comments:

1. A dashboard read must never `select *` from a table holding secrets → the account repository exposes a `SAFE_ACCOUNT_SELECT` and the encrypted token is never in it.
2. A workflow lookup must never be reachable without a `workspaceId` → it is a required positional argument on every workflow repository method.
3. A cookie naming a tenant is an untrusted claim → it is validated against membership on every request before it is used.
