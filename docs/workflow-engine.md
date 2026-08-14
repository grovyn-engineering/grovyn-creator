# Workflow engine

The engine takes a normalized event and a workspace, and writes execution rows.
It imports no React, no Express, and no Meta types — its only I/O is Prisma and
the provider interface. That is what makes it unit-testable with a plain object
and a stub provider.

## Pipeline

```
Meta webhook payload
        │
        ▼  normalizer.ts — the only code that understands Meta's wire format
NormalizedEvent  { eventId, eventType, recipientAccountId, payload }
        │
        ▼  route by recipientAccountId → InstagramAccount → Workspace
        ▼  persist (unique eventId) → enqueue
        │
        ▼  engine.ts
   find ACTIVE workflows in this workspace for this trigger type
        │
        ▼  variables.ts — build the flat variable bag
        ▼  conditions.ts — pure (conditions, variables) => boolean
        │
   matched? ──no──▶ execution row, status SKIPPED, with the reason
        │yes
        ▼  actions.ts — execute in order through the provider
        ▼  execution row + one row per action result
```

## Why flat, not a node graph

The data model is `trigger → conditions[] → actions[]`, evaluated in order.
Conditions are ANDed. There is no branching, no nesting, no OR.

The prior system used an arbitrary node/edge graph with delays, A/B splits and
resumable sub-flow jumps. That is more powerful and much harder to read. Nothing
V1 does needs the extra power, and the readability *is* the product feature: the
builder renders the workflow as a sentence, and the execution record is a flat
list rather than a traversal.

A user who needs OR creates a second workflow — easier to explain, and easier to
observe in the execution log.

## Condition evaluation

`evaluateConditions` is pure. Given the same conditions and variable bag it
always returns the same result, and it touches nothing.

Comparison normalizes both sides: NFKC, trim, lowercase without a locale.
`toLocaleLowerCase` would make the answer depend on the server's locale;
plain `toLowerCase` mishandles non-ASCII input that Instagram comments routinely
contain.

### Fail-closed on missing fields

A condition reading a field the event does not carry evaluates **false for every
operator, including the negative ones**.

This is the single most consequential rule in the engine. If a missing field
were treated as an empty string, `not_contains "price"` would be vacuously true
and the workflow would fire on an event it was never written for. The prior
system encoded the same rule for its follower check; generalising it is what
stops a negative condition becoming a catch-all.

An empty string is *not* the same as a missing field — an empty comment
genuinely does not contain "price", which is an ordinary non-match with an
ordinary reason.

### Prototype safety

Both the evaluator and the interpolator use `Object.hasOwn` rather than a bare
property read. A plain lookup walks the prototype chain, so `{{constructor}}` in
a user-authored message resolved to `function Object() { [native code] }` and
would have been posted as a public Instagram reply. That was a real defect,
caught by a unit test, and the guard is now in both places.

## Variables

The bag is flat and string-valued. Both consumers — condition fields and
`{{placeholder}}` interpolation — need only a map lookup, with no path walking
over attacker-influenced input. A general expression evaluator here is where an
injection surface would start.

| Trigger | Available |
| --- | --- |
| `COMMENT_RECEIVED` | `comment.text`, `comment.author_username`, `comment.post_id`, `comment.id`, `username` |
| `MESSAGE_RECEIVED` | `message.text`, `message.sender_username`, `username` |
| `MENTION_RECEIVED` | `mention.text`, `mention.author_username`, `username` |

`username` is an alias, so a message body can say `Hi {{username}}` without the
author knowing which event type they are writing for.

An unresolved placeholder is replaced with an empty string, not left as literal
`{{username}}`. A public reply reading "Hi {{username}}" is a visible failure on
the customer's own feed; a slightly terse "Hi" is not. Unresolved names are
recorded so the execution detail can show them.

## Idempotency

Two constraints, at different levels:

```
WebhookEvent.eventId                          @unique
WorkflowExecution(workflowId, webhookEventId) @unique
```

`eventId` is derived only from Meta's own identifiers — `ig:comment:<id>`. It
must never include a receipt timestamp or a random value, or a redelivery would
look like a new event.

Both are **constraints, not read-then-write checks**. A check races:
redeliveries arrive in bursts and two workers can both observe "not present"
before either inserts. The second constraint means an event that somehow slips
past the first still cannot execute a workflow twice.

## Execution records

Every matched workflow gets an execution row — including ones whose conditions
evaluated false, recorded as `SKIPPED` with the reason.

Recording only the runs that fired would leave a user asking "why didn't my
workflow do anything?" with nothing to look at, which is the most common support
question a product like this generates. The reason names the specific condition
that rejected the event, because evaluation short-circuits on the first failure.

Each action gets its own result row, so a partially successful execution reports
exactly which step failed rather than collapsing to one status. Later actions
still run when an earlier one fails: "reply publicly, then DM" should still send
the DM when the reply fails, and one provider hiccup should not become a total
loss.

`WorkflowExecutionAction.actionId` is `SetNull`, and `actionType` is
snapshotted, so deleting an action from a workflow does not erase the record
that it once ran.

## Execution modes

| Mode | Behaviour |
| --- | --- |
| `LIVE` | Actions call the provider. |
| `DRY_RUN` | Matching and evaluation run for real; the outbound call is suppressed and the action is recorded as `SKIPPED` with what it would have done. |

The Test button uses `DRY_RUN`. Same trigger matching, same evaluator, same
executors — only the far end differs. A test that took a different code path
would tell the user very little, because what they want to know is whether their
conditions match real wording.

Dry runs are excluded from every dashboard figure. Counting them would let a
user inflate their own success rate by pressing Test, and would make the
dashboard disagree with what actually happened on Instagram.

## Error handling

Provider failures are classified rather than retried blindly:

| Kind | Retryable | Meaning |
| --- | --- | --- |
| `TOKEN_INVALID` / `TOKEN_REVOKED` | no | Account must be reconnected |
| `RATE_LIMITED` | yes | Honours `Retry-After`, else exponential backoff with jitter |
| `PERMISSION_DENIED` | no | Missing scope — configuration or App Review |
| `BAD_REQUEST` | no | Malformed, or outside the 24-hour messaging window |
| `TRANSIENT` | yes | Network, timeout, or 5xx |

Jitter matters because a rate limit tends to hit every worker at once, and
identical backoff would have them all retry in lockstep.

Meta's own error message never reaches the user — it names internal fields and
object ids. `MetaApiError.toAppError()` produces a user-safe sentence; the
original goes to the log.

A poison event stops after 5 attempts. A payload the normalizer cannot handle
fails identically on attempt five hundred, and the row stays in the database
either way, so nothing is lost by stopping.

## Extending

Adding an action type:

1. A variant in `workflowActionInputSchema` (contracts) — this is what validates
   the `configuration` JSON on both write and read.
2. A member in `WorkflowActionType` in `schema.prisma`; the parity test fails
   until both sides agree.
3. A case in `executeAction`, plus a method on `SocialProvider` if it needs one.
4. An entry in `ACTION_META` in the builder.

No migration beyond the enum. `configuration` is `Json` precisely so a new
action does not reshape the table.
