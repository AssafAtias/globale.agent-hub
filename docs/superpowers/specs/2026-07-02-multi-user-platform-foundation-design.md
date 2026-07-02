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
2. User model: `entraObjectId`, `name` (role already exists).
3. Per-user runner binding (`runners.userId`) and run ownership (`runs.userId`).
4. Agent ownership (`agents.ownerId`) for routing webhook/cron/handoff runs.
5. User-scoped `claimNext` so each runner drains only its owner's queue.
6. Authorization: `member` vs `admin`; own-runs-only visibility.
7. Server containerization for Podman (Dockerfile + compose + DB volume +
   idempotent DB-init on start).
8. Backward-compatibility gate (`AUTH_ENABLED`) + migration to a bootstrap admin.

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
  URI, and a shared host to run the Podman container.

## Architecture

Three auth realms, deliberately kept separate:

| Surface | Auth | Change |
|---|---|---|
| Browser + dashboard API | Entra SSO → signed session cookie | **NEW** |
| Runner endpoints (`/api/runs/next`, `/result`, `/events`) | `x-runner-token` (existing per-runner hashed token) | unchanged |
| Webhooks (`/webhooks/*`) | existing per-source secret token | unchanged |

### 1. Data model (all additive — no destructive changes)

- **`users`** (exists: `id`, `email`, `role` default `member`) — add:
  - `entraObjectId` (text, unique) — the Entra `oid` claim, the join key.
  - `name` (text).
- **`runners`** — add `userId` (text, FK → `users.id`, nullable for migration).
  A runner now belongs to a person.
- **`runs`** — add `userId` (text, FK → `users.id`, nullable) — the run's
  **owner** (whose runner/Claude login must execute it).
- **`agents`** — add `ownerId` (text, FK → `users.id`, nullable) — who owns
  webhook/cron/handoff runs of this agent.

### 2. Authentication flow (in-app OIDC)

- A Fastify `authPlugin` protects human-facing routes. No valid session cookie
  on a browser/API request → redirect to Entra `/authorize`. Callback validates
  the `id_token`, upserts a `users` row keyed on `entraObjectId`, sets a signed
  HTTP-only session cookie (`@fastify/secure-session`).
- Runner and webhook routes are exempt from the session plugin — they keep
  their existing token auth.
- **Bootstrap:** the first-ever login when the users table is empty is promoted
  to `admin`; subsequent new users default to `member`.
- New env: `AUTH_ENABLED`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
  `ENTRA_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_BASE_URL`.

### 3. Run routing & ownership (the core change)

- `claimNext(runnerId)` → `claimNext(runnerId, runnerUserId)`. The claim query
  gains `AND runs.user_id = :runnerUserId`. The route already resolves the
  `runner` row via `findByToken`, so it passes `runner.userId`. Each runner
  claims **only its owner's** pending runs. The atomic
  `BEGIN IMMEDIATE` transaction is otherwise unchanged.
- **Ownership assignment at run creation:**
  - Manual (dashboard) → `userId` = logged-in user.
  - Webhook / cron / handoff → `userId` = the agent's `ownerId`.
- A run whose owner has **no online runner** stays `pending` and the dashboard
  labels it "waiting for {owner}'s runner." The existing `RunReaper` watchdog
  still force-fails genuine stalls (running > stale timeout) — unaffected.

### 4. Authorization / roles

- **member:** log in; see the shared **agent roster** (agent *definitions* are
  shared config, so anyone can trigger them); see **only their own runs**;
  trigger manual runs (owned by them); register/manage **their own** runners
  and tokens.
- **admin:** all of the above + see **all** runs; create/edit/delete agents;
  set an agent's `ownerId`; manage users and roles.
- Run-list and run-detail queries are filtered by `userId` for members;
  unfiltered for admins.

### 5. Containerization (Podman — server only)

- Multi-stage `Dockerfile` for `apps/server`: build stage runs `tsc`; runtime
  stage runs `node dist/index.js` as a non-root user.
- `compose.yaml`: server + a **named volume for `agent-hub.db`** (SQLite must
  persist across restarts/redeploys) + sibling dependency containers
  (RabbitMQ/Redis/etc.) as required. Secrets via env file / Podman secrets —
  never baked into the image.
- **DB init on start:** there is no runtime migrator today. Add a guarded,
  **idempotent** init step (invoked on container start) that ALTERs only the
  missing columns and backfills — matching the manual `ALTER TABLE ... ADD
  COLUMN` pattern already used for this DB. Running it twice is a no-op.
- The **runner stays outside the container**. Ship `run-runner.ps1` + README so
  each teammate starts their runner in one command against their own `~/.claude`
  and a personal runner token minted from the dashboard.

### 6. Migration & backward-compatibility

- New columns are nullable and backfilled to a bootstrap `admin` user; existing
  runs/runners/agents are assigned to it, so current single-operator use keeps
  working through the migration.
- `AUTH_ENABLED=false` (default until Entra is provisioned) preserves today's
  open-dashboard behavior — same gating pattern as the Teams bot's
  `MICROSOFT_APP_ID`. Flip to `true` once the Entra app + redirect URI exist.
- `claimNext` back-compat: a runner with a null `userId` claims runs whose
  `userId` is null, so nothing strands mid-migration.

## Error handling

- Invalid/expired session → redirect to login (browser) or 401 (API/XHR).
- Missing Entra env while `AUTH_ENABLED=true` → server fails fast at startup
  with a clear message (don't boot a half-secured server).
- Run with an owner but no online runner → stays `pending`, dashboard shows a
  clear waiting state; watchdog untouched.
- Runner presenting a token whose user was deleted → 401 (treated like an
  invalid token).

## Testing

- **Unit:** `claimNext` user-scoping (runner A never claims runner B's run;
  null-user legacy path); ownership assignment per trigger type
  (manual/webhook/cron/handoff); bootstrap-admin promotion; role gate on admin
  routes.
- **Auth:** session-required redirect for browser; 401 for API; runner-token
  and webhook realms provably untouched.
- **Container:** DB named volume persists across container restart; idempotent
  DB-init runs twice with no error and no duplicate columns.

## Open questions

1. Does the shared host already exist, or does it need IT provisioning (affects
   sequencing of the container step vs. the auth step)?
2. Confirm the Entra redirect-URI / consent process with IT — reuse the Teams
   bot app registration or a new one?
3. Should an admin be able to *reassign* an agent's `ownerId` to hand off a
   webhook agent to another teammate's runner? (Assumed yes; low cost.)

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
