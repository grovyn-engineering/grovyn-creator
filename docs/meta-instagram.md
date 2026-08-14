# Meta / Instagram integration

Everything in this document was verified against Meta's official documentation
on **2026-08-13**. Meta changes this platform frequently and deprecates Graph
API versions on a published schedule — re-check the linked pages before relying
on any specific claim here.

Sources:

- [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/)
- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/)
- [Instagram webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)

---

## Which Instagram product this uses

Meta offers two overlapping products, and choosing the wrong one produces
authentication failures that are very hard to diagnose because both look
plausible:

| | **Instagram API with Instagram Login** (this is what SocialPilot uses) | Instagram API with Facebook Login |
| --- | --- | --- |
| User signs in with | Their Instagram account | Their Facebook account |
| Requires a linked Facebook Page | No | Yes |
| Graph host | `graph.instagram.com` | `graph.facebook.com` |
| Scope prefix | `instagram_business_*` | `instagram_basic`, `pages_*` |

SocialPilot uses **Instagram Login**. It does not require the customer to have
a Facebook Page, which removes the single most common onboarding failure for a
product like this.

The consequence worth remembering: **the host is `graph.instagram.com`.** Tokens
issued by this flow are rejected by `graph.facebook.com`, and the resulting
error does not say why.

---

## Required app configuration

In the [App Dashboard](https://developers.facebook.com/apps):

1. Create an app with the **Business** type.
2. Add the **Instagram** product, then **API setup with Instagram login**.
3. Note the **Instagram App ID** and **Instagram App Secret**. These are *not*
   the same as the Facebook App ID/Secret shown on the main settings page —
   using the latter fails at token exchange.
4. Under **Business login settings**, add the redirect URI. It must match
   `META_REDIRECT_URI` **exactly**, including scheme, host, port, and path.

Then set:

```env
META_APP_ID=<Instagram App ID>
META_APP_SECRET=<Instagram App Secret>
META_REDIRECT_URI=https://api.your-domain.com/api/instagram/callback
META_WEBHOOK_VERIFY_TOKEN=<any string you choose>
META_GRAPH_VERSION=v23.0
USE_MOCK_INSTAGRAM=false
```

`META_APP_SECRET` is server-only. It never reaches the browser, and there is no
`NEXT_PUBLIC_` variable that carries it.

### Why the version is pinned

`META_GRAPH_VERSION` is pinned rather than floating. Each Graph API version has
a published deprecation date; following "latest" implicitly would mean a
breaking change arrives without a deploy, on Meta's schedule rather than yours.
Bumping it is a deliberate change with a testable diff.

---

## Permissions

SocialPilot requests exactly three scopes:

| Scope | Why |
| --- | --- |
| `instagram_business_basic` | Required for any call. Grants the profile read used to identify the connected account and list recent media for the post picker. |
| `instagram_business_manage_comments` | Read comments from webhooks and post replies. |
| `instagram_business_manage_messages` | Read and send direct messages. |

`instagram_business_content_publish` is deliberately **not** requested.
SocialPilot never posts to a feed, and requesting a permission the product does
not exercise is both a trust problem and a reliable App Review rejection.

> The older scope names (`business_basic`, `business_manage_comments`, and so
> on) were deprecated on 2025-01-27 and no longer work.

---

## OAuth flow

All of it runs server-side. The frontend asks the API for a URL and navigates
the browser there; it never sees the app secret or the authorization code.

```
Browser              API (SocialPilot)            Meta
   │                        │                       │
   │  GET /api/instagram/connect                    │
   │───────────────────────>│                       │
   │                        │ mint + store `state`  │
   │  { authorizeUrl }      │                       │
   │<───────────────────────│                       │
   │                                                │
   │  top-level navigation to instagram.com/oauth/authorize
   │───────────────────────────────────────────────>│
   │                                    user consents
   │  302 back to META_REDIRECT_URI?code=…&state=…  │
   │<───────────────────────────────────────────────│
   │                        │                       │
   │  GET /api/instagram/callback                   │
   │───────────────────────>│                       │
   │                        │ 1. verify + consume state
   │                        │ 2. code → short-lived token
   │                        │──────────────────────>│
   │                        │ 3. short → long-lived token
   │                        │──────────────────────>│
   │                        │ 4. fetch profile      │
   │                        │──────────────────────>│
   │                        │ 5. encrypt + store    │
   │  302 to the app        │                       │
   │<───────────────────────│                       │
```

### Endpoints

| Step | Method | URL |
| --- | --- | --- |
| Authorize | GET (browser) | `https://www.instagram.com/oauth/authorize` |
| Code → short-lived token | POST | `https://api.instagram.com/oauth/access_token` |
| Short → long-lived token | GET | `https://graph.instagram.com/access_token` |
| Refresh | GET | `https://graph.instagram.com/refresh_access_token` |

Two details that cost a debugging cycle each:

- **Token exchange and refresh live on unversioned paths.** Prefixing
  `/access_token` or `/refresh_access_token` with `/v23.0` returns an opaque
  400. Resource endpoints *are* versioned.
- **Scopes are comma-separated**, not space-separated. Instagram departs from
  the OAuth 2 convention here and silently ignores a space-separated list.

### Token lifetimes

| Token | Lifetime | Notes |
| --- | --- | --- |
| Authorization code | 1 hour | Single use. A retry after a partial failure fails with "code already used", which is why `exchangeCode` sets `maxAttempts: 1`. |
| Short-lived | ~1 hour | SocialPilot never stores this — it exchanges immediately for a long-lived token, so an account cannot silently die an hour after connecting. |
| Long-lived | 60 days | Refreshable once it is at least 24 hours old. |

A long-lived token that goes 60 days without a refresh **expires permanently**
and the customer must reconnect. SocialPilot refreshes eagerly whenever a token
has under 7 days left, checked on every use — so an actively used workspace
never lapses. A dormant workspace can still expire; it surfaces in the UI as a
Reconnect prompt rather than as silent failure.

---

## Webhooks

### Configuration

In the App Dashboard, under **Instagram → Webhooks**:

- **Callback URL**: `https://api.your-domain.com/api/webhooks/instagram`
- **Verify token**: the value of `META_WEBHOOK_VERIFY_TOKEN`
- **Subscribe to fields**: `comments`, `messages`, and `mentions` if wanted

The callback URL must be **publicly reachable over HTTPS with a valid
certificate**. Meta will not deliver to `http://`, to a self-signed
certificate, or to `localhost`. See "Local development" below.

After the app-level subscription, each connected account must **also** be
subscribed via `POST /me/subscribed_apps`. SocialPilot does this automatically
at the end of the OAuth callback.

That call is non-fatal on failure: the account is already stored and usable for
everything except inbound events, and failing the whole connection would send
the customer back to the start over something a retry fixes. The failure is
logged at error level, and the symptom is an Activity page that stays empty.

### Verification handshake

Meta sends `GET` with `hub.mode=subscribe`, `hub.verify_token`, and
`hub.challenge`. SocialPilot compares the token in **constant time** (this
endpoint is public and directly probeable, so `===` would leak the token's
length and prefix through timing) and echoes the challenge back as plain text.

### Signature verification

Every `POST` carries `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the
raw request body keyed with the app secret.

SocialPilot verifies against the **raw received bytes**, which is why
`apps/api/src/app.ts` captures `req.rawBody` for this route specifically.
Re-serialising the parsed object would change key order and unicode escaping,
and the signature would never match.

An unsigned or wrongly signed payload is rejected with 403 without being read.
The one exception is development with the mock provider, where there is no app
secret to sign with; that relaxation is gated on `NODE_ENV !== "production"`.

### Delivery contract

Meta expects a `200` **quickly**. A slow response counts as a failed delivery,
and enough failures disable the subscription outright — a silent, total outage
of the product's core function.

So the handler verifies the signature, answers `200`, and only then persists and
enqueues. Workflow execution happens on a worker. The webhook route also has
**no rate limiter**: a 429 is recorded as a delivery failure, and Meta bursts
hard after any outage.

### Idempotency

Meta redelivers. SocialPilot derives a deterministic `eventId` from Meta's own
identifiers (`ig:comment:<commentId>`) and enforces uniqueness at the database
level. A redelivery conflicts on insert and is discarded.

This is a constraint, not a read-then-write check, because a check races —
redeliveries arrive in bursts and two workers can both observe "not present"
before either inserts. A second constraint, `@@unique([workflowId,
webhookEventId])`, means even an event that somehow slips past the first cannot
execute a workflow twice.

---

## Local development

### Option A — the mock provider (default, no Meta account needed)

```env
USE_MOCK_INSTAGRAM=true
```

The API serves its own consent screen at `/api/instagram/mock/authorize`, which
redirects into the **real** callback. State verification, code exchange,
encryption, upsert, and audit logging all run exactly as they do in production —
only the far end is simulated. Actions are logged instead of sent.

The screen is deliberately plain and labelled as a mock; nobody should mistake
it for Instagram. `getProvider()` throws if this is ever constructed with
`NODE_ENV=production`, and `env.ts` refuses to boot in that combination — two
independent guards, because serving fabricated data to a paying customer is the
failure this must not have.

To exercise the full pipeline, post a webhook to the local API yourself:

```bash
curl -X POST http://localhost:5000/api/webhooks/instagram \
  -H 'Content-Type: application/json' \
  -d '{"object":"instagram","entry":[{"id":"mock_seed_account","time":1754000000,"changes":[{"field":"comments","value":{"id":"c_test_1","text":"what is the price?","from":{"id":"u1","username":"curious_buyer"},"media":{"id":"p1"}}}]}]}'
```

Post it twice — the second is deduplicated, which is the idempotency guarantee
visible from outside.

### Option B — real Meta credentials

Webhooks need a public HTTPS URL, so expose the local API with a tunnel
(`cloudflared tunnel --url http://localhost:5000`, `ngrok http 5000`, or
similar), then set `BACKEND_URL` and `META_REDIRECT_URI` to the tunnel's
hostname and register the callback in the App Dashboard.

Instagram test users can authorize an app in development mode. A real
professional account can too, provided it has a role on the app.

---

## Going to production

Meta gates the permissions this product needs. **An App ID and secret do not by
themselves grant production access** — in development mode the app can only act
on accounts with a role on it.

Required before public launch:

1. **Business verification** of the legal entity that owns the app.
2. **App Review** for `instagram_business_manage_comments` and
   `instagram_business_manage_messages`, each with a screencast showing the
   permission being used in the real product.
3. A **privacy policy URL** and a **data deletion callback**, both publicly
   reachable.
4. The app switched from Development to **Live**.

Review typically takes days to weeks and can be rejected for reasons that are
not obvious from the submission. Budget for at least one round trip.

Note that customers must connect an Instagram **professional** account —
Business or Creator. A personal account cannot be connected, and the failure
comes back from Meta rather than from SocialPilot.

---

## Known gaps

These are real limitations, stated plainly rather than hidden:

- **A failed webhook subscription is not retried.** The `subscribed_apps` call
  runs once at connect and is non-fatal. If it fails, the account stays
  connected but receives no events until the customer reconnects. A background
  reconciliation job would close this.
- **The 24-hour messaging window is not pre-checked.** Meta rejects a DM sent
  more than 24 hours after the person last messaged the account. SocialPilot
  attempts the send and records the rejection on the action result rather than
  predicting it. The outcome is correct and visible, but it costs an API call
  and shows the user a failure that could have been a skip.
- **Rate-limit headers are not persisted.** `X-App-Usage` is read for backoff
  decisions but not stored, so there is no dashboard showing how close a
  workspace is to its quota.
- **Token refresh is opportunistic, not scheduled.** It happens when a token is
  used. A workspace that receives no events for 60 days expires and must
  reconnect; a periodic refresh job would close this.
