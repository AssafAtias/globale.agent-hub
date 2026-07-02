# Multi-User Platform Foundation — Design

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Repo:** `globale.agent-hub`
**Sub-project:** ① of a 4-part sequence (see [Roadmap](#roadmap-follow-up-sub-projects))

## Problem

`globale.agent-hub` today is a single-operator local tool. There is no user
authentication — the dashboard and API are open; the only credential in the
system is the per-runner `x-runner-token`. The team lead wants the whole team
to use it, with per-user authentication.

The hard constraint that shapes everything: **agents run under a personal
Claude *subscription*, not a shareable API key.** The runner executes
`claude -p` against a logged-in `~/.claude` OAuth token that only a running
Claude Code session refreshes. There is no shared API key and no separate
quota. This is precisely why an earlier "containerize everything" attempt
(roadmap Phase 3B) was dropped: a runner cannot go headless in a container
because it needs a human's Claude login, and a single shared login is one
quota pool that 429s under concurrent team use.

## Chosen model

**Central dashboard + per-user runners.** One shared server everyone logs into.
Each teammate runs a lightweight runner on their own machine using their own
Claude login. The server routes each run to its owner's runner, so every
person's work burns their own quota under their own identity.

Locked decisions (from brainstorm):

| Decision | Choice |
|---|---|
| Sharing model | Central dashboard + per-user runners |
| Authentication | Microsoft Entra SSO (in-app OIDC) |
| Server host | Podman container on a shared internal host |
| Run routing | Per-user run queue (filter `claimNext` by owner) |
| Run/agent visibility | Own runs only; admins see everything |

## Scope

**In scope (this sub-project):**

1. Entra SSO login for the human-facing dashboard/API (in-app OIDC, session cookie).
2. User model: add `entraObjectId`, `name` (`role` already exists).
3. Per-user runner binding (`runners.userId`) and run ownership (`runs.userId`).
4. Agent ownership (`agents.ownerId`, **required/backfilled**) for routing
   webhook/cron/handoff runs.
5. User-scoped `claimNext` so each runner drains only its owner's queue, plus
   threading owner assignment through `RunRepository.create` and every
   non-manual creation site.
6. Authorization: `member` vs `admin`; own-runs-only run visibility (shared
   agent roster).
7. Server containerization for Podman (Dockerfile + compose + DB volume +
   Drizzle `migrate()` at container start).
8. A minimal **stale-run reaper** (see §Error handling) — introduced here, not
   pre-existing, because multi-user routing makes orphaned `running` runs more
   likely and no reaper exists today.
9. Backward-compatibility gate (`AUTH_ENABLED`) + a `0007` migration to the new
   columns with a bootstrap-admin backfill.

**Non-goals (this sub-project):**

- Team-Leader fan-out orchestration (sub-project ②).
- Automation-tests agent write/execute tool permissions (sub-project ③).
- Monitoring-agent hardening (sub-project ④).
- Containerizing the runner (structurally impossible under subscription auth —
  documented, not attempted).
- Replacing the runner-token or webhook-secret auth realms.

## Owners

- **Design/implementation lead:** assaf.atias@global-e.com
- **External dependency:** IT / Entra admin for the app registration + redirect
  URI, TLS for the shared host, and a host to run the Podman container.

## Architecture

Three auth realms, deliberately kept separate:

| Surface | Auth | Change |
|---|---|---|
| Browser + human API (`GET/POST /api/runs`, `PATCH`, `/respond`, agent/user admin) | Entra SSO → signed session cookie | **NEW** |
| Runner endpoints (`/api/runs/next`, `/result`, `/events`) | `x-runner-token` (existing per-runner hashed token) | unchanged |
| Webhooks (`/webhooks/*`) | existing per-source secret token | unchanged |

`buildApp` (`app.ts`) today registers all routes flat, with no auth hook. To
keep the runner/webhook realms untouched while protecting human routes, the
auth plugin must be applied by **scope, not globally**:

- Split `buildRunsRoutes` so the runner endpoints (`/next`, `/result`,
  `/events`) register in a scope **without** the auth hook, and the human run
  endpoints (`GET /api/runs`, `POST /api/runs`, `PATCH`, `/respond`) register in
  a scope **with** it. (Equivalently: a per-route allowlist that skips the three
  runner paths.) Webhook routes stay outside the auth scope.
- The human run endpoints additionally gain `userId` assignment (POST) and
  `userId` filtering (GET) — see §3/§4.

### 1. Data model (additive migration `0007`)

- **`users`** (exists: `id`, `email`, `role` default `member`) — add:
  - `entraObjectId` (text, unique) — the Entra `oid` claim, the join key.
  - `name` (text).
- **`runners`** — add `userId` (text, FK → `users.id`). Backfilled to the
  bootstrap admin so no runner has a null owner. A runner belongs to a person.
- **`runs`** — add `userId` (text, FK → `users.id`) — the run's **owner** (whose
  runner/Claude login must execute it). Existing rows backfilled to the
  bootstrap admin.
- **`agents`** — add `ownerId` (text, FK → `users.id`), **required**; existing
  rows backfilled to the bootstrap admin. Owns webhook/cron/handoff runs of this
  agent.

SQLite note: `ALTER TABLE ADD COLUMN` cannot add a `NOT NULL` FK column without
a default, so the `0007` migration adds the columns nullable, backfills to the
bootstrap admin, and enforces required-ness in application code (and, for
`agents.ownerId`, in the create/update paths) — the same shape existing
migrations use.

### 2. Authentication flow (in-app OIDC)

- A Fastify `authPlugin` protects the human scope. No valid session cookie on a
  browser/API request → redirect to Entra `/authorize` (browser) or 401 (XHR).
  Callback validates the `id_token`, upserts a `users` row keyed on
  `entraObjectId`, sets a signed session cookie via `@fastify/secure-session`.
- **Session cookie attributes:** `HttpOnly`, `SameSite=Lax`, `Path=/`, and
  `Secure` **when served over TLS**. The shared host is assumed to terminate TLS
  (direct HTTPS or a TLS-terminating reverse proxy); on plain HTTP a `Secure`
  cookie is silently dropped and login breaks, so TLS is a deployment
  precondition, called out in the runbook.
- `PUBLIC_BASE_URL` must exactly equal the redirect URI registered in the Entra
  app, or Entra rejects the callback.
- Runner and webhook routes are exempt (registered outside the auth scope).
- **Bootstrap:** the first-ever login when the users table is empty is promoted
  to `admin`; subsequent new users default to `member`.
- New env: `AUTH_ENABLED`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
  `ENTRA_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_BASE_URL`. When
  `AUTH_ENABLED=true` and any Entra var is missing, the server fails fast at
  startup (don't boot a half-secured server).

### 3. Run routing & ownership (the core change)

- `claimNext(runnerId)` → `claimNext(runnerId, runnerUserId)`. Inside the
  existing `BEGIN IMMEDIATE` transaction, the single-row select
  (`db.select().from(runs).where(eq(runs.status,'pending')).get()`) gains
  `AND runs.user_id = :runnerUserId` **in the `where(...)`** (so the scoping
  picks the oldest pending run *for that user*, not a post-filter). The route
  already resolves the `runner` row via `RunnerRepository.findByToken`
  (a `select().from(runners)`, which picks up the new `userId` column
  automatically), so it passes `runner.userId`. Everything else in the
  transaction is unchanged.
- **Ownership assignment at run creation.** `RunRepository.create` currently
  accepts only `{ agentId, trigger, triggerPayload, context, replyTo }`; it must
  be extended to accept `userId`, and every creation site must set it:
  - Manual (dashboard, `POST /api/runs`) → `userId` = logged-in user.
  - Webhook (`webhooks.ts`, 3 sites), cron (`Scheduler.ts`), handoff
    (`runs.ts` handoff branch) → `userId` = the triggering agent's `ownerId`.
- Because `agents.ownerId` is required and every non-manual site resolves it,
  non-manual runs always have a claimable owner — no null-owner strand. The same
  shared agent can legitimately produce runs owned by different users (a member
  manually triggering it → owned by them; its webhook → owned by the agent
  owner); this is intended, and the routing handles each independently.
- A run whose owner has **no online runner** stays `pending` and the dashboard
  labels it "waiting for {owner}'s runner." That is expected (it runs when they
  come online) and is *not* a stall. Genuine stalls are `running` runs whose
  runner died — handled by the reaper (§Error handling).

### 4. Authorization / roles

- **member:** log in; see the shared **agent roster** (agent *definitions* are
  shared config, so anyone can trigger them); see **only their own runs**;
  trigger manual runs (owned by them); register/manage **their own** runners
  and tokens.
- **admin:** all of the above + see **all** runs; create/edit/delete agents; set
  an agent's `ownerId`; manage users and roles.
- `GET /api/runs` and run-detail are filtered by `userId` for members;
  unfiltered for admins. Agent-roster reads are unfiltered (shared config);
  agent writes and user management are admin-only.

### 5. Containerization (Podman — server only)

- Multi-stage `Dockerfile` for `apps/server`: build stage runs `tsc`; runtime
  stage runs `node dist/index.js` as a non-root user.
- `compose.yaml`: server + a **named volume for `agent-hub.db`** (SQLite must
  persist across restarts/redeploys) + sibling dependency containers
  (RabbitMQ/Redis/etc.) as required. Secrets via env file / Podman secrets —
  never baked into the image.
- **Schema application:** the repo has Drizzle-kit migrations under
  `apps/server/src/db/migrations` (generated `.sql` + `meta/_journal.json`) but
  **no startup `migrate()` call** — today they are applied out-of-band, and
  `assertTeamsColumns()` in `app.ts` is a fail-fast guard, not an applier. For
  the container we add a **journal-aware `migrate()` at startup** (Drizzle's
  better-sqlite3 migrator) run against the named-volume DB before the server
  listens. This is idempotent (the journal skips already-applied migrations),
  authors the new columns via the `0007` migration, and avoids a bespoke
  ALTER-differ that would diverge from `_journal.json`. `assertTeamsColumns`
  stays as a belt-and-suspenders guard.
- The **runner stays outside the container**. Ship `run-runner.ps1` + README so
  each teammate starts their runner in one command against their own `~/.claude`
  and a personal runner token minted from the dashboard.

### 6. Migration & backward-compatibility

- `0007` migration adds the new columns nullable, then backfills a bootstrap
  `admin` user and assigns all existing runs/runners/agents to it, then the app
  treats `agents.ownerId` and `runs.userId` as required going forward. No null
  owners remain, so nothing strands mid-migration.
- `AUTH_ENABLED=false` (default until Entra is provisioned) preserves today's
  open-dashboard behavior — same gating pattern as the Teams bot's
  `MICROSOFT_APP_ID`. Flip to `true` once the Entra app + redirect URI + TLS
  exist.
- Legacy runners: after migration every runner has a non-null `userId`; there is
  no null-user claim path (removed from the earlier draft, which would have
  stranded non-manual runs).

## Error handling

- Invalid/expired session → redirect to login (browser) or 401 (API/XHR).
- Missing Entra env while `AUTH_ENABLED=true` → fail fast at startup.
- Run owned by a user with no online runner → stays `pending`, dashboard shows a
  clear "waiting for {owner}'s runner" state. Expected, not an error.
- **Stale-run reaper (new, in scope):** no watchdog exists today, so a `running`
  run whose runner died stays `running` forever. Add a minimal periodic reaper
  (server-side interval) that force-fails any run in `running` older than a
  configurable `RUN_STALE_TIMEOUT_MS`, writing a clear error. Skipped under
  `NODE_ENV=test`. This is the safety net the routing relies on; it is being
  built here, not assumed.
- Runner presenting a token whose user was deleted → 401 (treated like an
  invalid token).

## Testing

- **Unit — routing:** `claimNext` user-scoping (runner A never claims runner
  B's run; the `WHERE` is inside the transaction's single-row select);
  ownership assignment for each trigger type (manual → triggerer; webhook /
  cron / handoff → agent `ownerId`) via the extended `RunRepository.create` and
  each call site.
- **Unit — auth/roles:** bootstrap-admin promotion on first login; role gate on
  admin-only routes; `member` `GET /api/runs` returns only own runs.
- **Unit — reaper:** a `running` run older than the timeout is force-failed;
  a fresh `running` run is not; disabled under `NODE_ENV=test`.
- **Auth realms:** session-required redirect (browser) / 401 (API) on the human
  scope; runner-token endpoints (`/next`, `/result`, `/events`) and webhook
  routes provably still authenticate by token only (no session required).
- **Cookie security:** session cookie carries `HttpOnly`, `SameSite=Lax`, and
  `Secure` when TLS is on.
- **Visibility model:** member A triggers shared agent X → A sees A's run;
  member B sees agent X in the roster but not A's run; admin sees both.
- **Container:** DB named volume persists across container restart; startup
  `migrate()` runs twice with no error and no duplicate columns (journal-aware).

## Open questions

1. Does the shared host already exist with TLS, or does it need IT provisioning
   (affects sequencing of the container step vs. the auth step)?
2. Confirm the Entra redirect-URI + TLS + consent process with IT — reuse the
   Teams bot app registration or a new one? `PUBLIC_BASE_URL` must match exactly.
3. Should an admin be able to *reassign* an agent's `ownerId` to hand a webhook
   agent to another teammate's runner? (Assumed yes; low cost.)

## Roadmap (follow-up sub-projects)

Each gets its own spec → plan → build cycle. ① (this doc) unblocks all.

- **② Team-Leader orchestrator agent** — a configured agent that dispatches to
  specialists. `<handoff>` exists but is capped at one handoff per run; a true
  orchestrator needs **fan-out** (dispatch to several agents) — authoring plus a
  targeted handoff extension.
- **③ Automation-tests agent** — needs **write + execute** tool permissions the
  runner currently forbids (read-only by design). A real security surface in a
  multi-user world — own design.
- **④ Monitoring-agent hardening** — formalize the existing cron + Sentry/
  Coralogix monitors into a first-class agent with proper output channels.
