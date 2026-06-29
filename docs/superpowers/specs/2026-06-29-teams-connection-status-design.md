# Teams Connection Status — Design

**Date:** 2026-06-29
**Repo:** `globale.agent-hub`
**Status:** Approved (spec review passed)

## Problem

The agent-hub has two Microsoft Teams integrations — a two-way bot (gated by
`MICROSOFT_APP_ID`) and a one-way Power Automate webhook (`TEAMS_WEBHOOK_URL`).
The server knows whether each is configured, but the client UI shows nothing.
A user cannot tell at a glance whether Teams is wired up, or which channel
(bot vs webhook) is active. This feature surfaces that state in the UI.

## Goal

Show a compact, always-visible Teams connection indicator in the client,
distinguishing the bot from the webhook, derived from server configuration.

## Non-goals (YAGNI)

- No active liveness probe (no pinging the webhook or Bot Framework). "Connected"
  means **configured** (env var present), not **verified live**.
- No status for other integrations (GitLab, Jira).
- No editing of Teams configuration from the UI.
- No exposure of secret values (app id, webhook URL) to the client.

## Decisions

| Question | Decision |
|---|---|
| What "connected" means | **Config presence** — relevant env var is set |
| Scope | **Teams only, two distinct states**: bot and webhook |
| Placement | **Sidebar footer**, above `SidebarAccount`, visible on every page |
| Visual | **Colored dot + channel name** (no label text), compact |

## Architecture

### Server — read-only status endpoint

New route module `apps/server/src/api/routes/integrations.ts`, exporting
`buildIntegrationsRoutes(config: Environment)` — a config-factory that returns a
Fastify plugin, following the `buildWebhooksRoutes(config)` / `buildRunsRoutes(config)`
factory style (NOT the bare-plugin `runnersRoutes` style), since it needs `config`.

**Registration must be UNCONDITIONAL.** In `app.ts`, register it with the always-on
routes (after the `app.register(buildSkillsRoutes(...))` line, ~line 51) — **outside**
the `if (teamsEnabled(config))` block (lines 34–44). The endpoint must respond even
when Teams is not configured (so it can report `connected: false`); placing it inside
the conditional block would 404 the endpoint in exactly the "neither configured" case
the UI needs to show.

Endpoint: `GET /api/integrations/teams`

Derives state purely from config — no network calls:

```jsonc
{
  "bot":     { "connected": true  },  // Boolean(MICROSOFT_APP_ID), via teamsEnabled(config)
  "webhook": { "connected": false }   // Boolean(config.TEAMS_WEBHOOK_URL)
}
```

- Reuses the existing `teamsEnabled(config)` helper for the bot.
- Adds a trivial `Boolean(config.TEAMS_WEBHOOK_URL)` check for the webhook.
- **Object-per-channel** shape (not bare booleans) so a future `lastVerifiedAt`
  or `probe` field can be added without breaking the client contract.
- Returns **only booleans** — no app id, no webhook URL. No secrets leave the server.
- TypeBox response schema, consistent with the existing Fastify + TypeBox setup.

### Client — data + component

1. **API client** (`apps/client/src/api/client.ts`): add a `TeamsStatus` type and
   `api.integrations.teams()` calling `GET /api/integrations/teams`.

2. **Component** `apps/client/src/components/TeamsStatus.tsx`:
   - Two rows: **Bot** and **Webhook**.
   - Each row: a small colored dot + the channel name. No "Connected"/"Not
     configured" text.
   - **Dot primitive**: the 6px circle from `StatusPill.tsx:15`
     (`width: 6, height: 6, borderRadius: '50%'`), used standalone — do **not**
     reuse the `StatusPill` component itself (it renders a labelled pill with a
     background, which contradicts the dot-only visual decision).
   - **Colors** (from `dashboard/palette.ts`):
     - connected → `colors.live` (`#4ade80`, green)
     - not configured → `colors.textFaint` (`#62626b`, muted grey)
     - query error / loading → `colors.textMuted` (`#8c8c95`, neutral) — see error handling
   - Data via `useQuery({ queryKey: ['integrations','teams'], queryFn: api.integrations.teams })`
     — same react-query pattern as `RunnersPage`.

3. **Placement**: rendered in `Layout.tsx` sidebar, immediately above
   `<SidebarAccount />` (before line 86). Add a `borderTop` divider matching the
   `SidebarAccount` convention so the two footer blocks don't visually merge.

### State mapping

| Condition | Bot dot | Webhook dot |
|---|---|---|
| `MICROSOFT_APP_ID` set | green | — |
| `TEAMS_WEBHOOK_URL` set | — | green |
| env var absent | faint grey (`textFaint`) | faint grey (`textFaint`) |
| query error / server down | neutral grey (`textMuted`) `—` for both (never a false "disconnected") |

## Data flow

`Layout` mounts `TeamsStatus` → `useQuery` → `GET /api/integrations/teams`
→ `buildIntegrationsRoutes` reads in-memory `config` → returns booleans
→ component renders two dots. No DB, no external calls.

## Error handling

- Server: pure config read; cannot fail under normal operation. Standard Fastify
  error handling applies.
- Client: on `isError` (server down / network), render neutral dots (`—`) rather
  than green/grey, so an unreachable server is not misread as "disconnected".

## Testing

- **Server**: route test at `apps/server/test/integrations/teams.test.ts` (mirrors the
  existing `teams/` subdir grouping). Drives the route with
  `app.inject({ method: 'GET', url: '/api/integrations/teams' })` (a real route test,
  unlike `teams/config.test.ts` which tests pure functions), building the app with
  different `config` fixtures: both set, only bot, only webhook, neither — asserting the
  returned `bot.connected` / `webhook.connected` booleans.
  - **Avoid bot-init side effects:** `buildApp(config)` runs `assertTeamsColumns()` and
    `createTeamsAdapter()` inside the `if (teamsEnabled(config))` block, which touch the DB
    and Teams adapter whenever `MICROSOFT_APP_ID` is set. To keep the route test isolated,
    register `buildIntegrationsRoutes(config)` on a bare Fastify instance in the test rather
    than going through the full `buildApp` — sidesteps those side effects entirely.
- **Client**: light render test of `TeamsStatus` for the three combinations, if the
  client test setup supports it; otherwise manual verification in the running app.

## Affected files

- `apps/server/src/api/routes/integrations.ts` (new)
- `apps/server/src/app.ts` (register route)
- `apps/server/test/integrations/teams.test.ts` (new)
- `apps/client/src/api/client.ts` (type + call)
- `apps/client/src/components/TeamsStatus.tsx` (new)
- `apps/client/src/components/Layout.tsx` (render component)

## Deployment note

Per agent-hub ops: the server runs from `dist/` — after merging, run `npx tsc` in
`apps/server` and restart `node dist/index.js`. This feature adds **no new env
vars and no DB migration**, so no manual DB changes are required.
