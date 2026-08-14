# frontend/types

The frontend's own copy of the API contract.

## Why this is duplicated

The backend owns the authoritative schemas in `backend/src/contracts/`. This
directory restates the subset the UI actually needs, so the two applications
are **independently deployable** — neither build depends on the other's source
tree, and the frontend can be deployed to a static host or a different platform
without reaching into the backend.

That independence has a real cost: these definitions can drift from the
backend's. Two things keep it honest rather than relying on discipline:

1. **`backend/src/config/contract-drift.test.ts`** parses this directory at test
   time and fails the build if an enum member here disagrees with
   `backend/src/contracts/`. Test-time coupling is not deploy-time coupling —
   the check runs in CI and the shipped artefacts stay independent.

2. **The server is always the real gate.** The Zod schemas here exist to give
   immediate inline form feedback and save a round trip. Every one of them is
   re-validated by the backend, which returns field-level errors that render
   against the same inputs. A schema here that drifted looser than the
   backend's produces a server-side rejection the UI displays correctly — it
   does not produce a security hole.

## What belongs here

Only what a React component or hook genuinely reads: request/response shapes,
the enums the UI branches on, and the form schemas.

**Do not** copy over engine internals, normalizer types, Prisma-shaped rows, or
anything the frontend does not render. If you find yourself needing one, that
is usually a sign the logic belongs on the server.

## Changing a contract

1. Change `backend/src/contracts/` first — it is authoritative.
2. Mirror the change here if the UI touches it.
3. Run `npm test --prefix backend`; the drift test tells you if you missed one.
