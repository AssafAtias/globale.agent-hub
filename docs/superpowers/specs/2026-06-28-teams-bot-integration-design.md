# Teams Bot Integration — Design

**Date:** 2026-06-28
**Repo:** `globale.agent-hub`
**Status:** Approved design, pending implementation plan

## Problem

Agents in the hub currently report only to GitLab (`pr_comment`), Jira (`jira`), or the
dashboard. There is no way for the user to *talk to* an agent, and no way for an agent to
proactively *report* into the place the team already lives: Microsoft Teams.

We want to wire the hub to Microsoft Teams so that:

1. **Reporting** — agents post run results / notifications into Teams.
2. **Conversation** — the user can message an agent from Teams (`@mention` + input), the
   agent runs, and the result is posted back into the same conversation/thread.
3. **Future** — agent-to-agent messaging (designed for, not built in v1).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Capability scope | **Full two-way bot** from the start (reporting + conversation). |
| Tenant access | **Unknown** — plan must front-load a discovery spike + documented fallback. |
| Addressing | **By name/@mention** — one bot ("Agent Hub"), parse `<slug>: <input>` from text. |
| Access control | **Allowlist** of Entra object IDs (starts with just the user). |
| Report target (non-Teams runs) | **Per-agent configured channel**, captured via `set-channel` command. |
| Implementation approach | **A — official Bot Framework SDK (`botbuilder`)** on the Fastify server. |
| Fallback if Azure blocked | **C — Power Automate / Workflows bridge** (same hub-side code, different transport). |

### Why approach A

The bot protocol's hard parts are security-sensitive: validating the inbound JWT from Azure
Bot Service, acquiring Entra tokens to call back into Teams, and proactive messaging via
conversation references. The official `botbuilder` SDK handles all of these. Hand-rolling
JWT validation (approach B) is a footgun; the Power Automate bridge (approach C) is kept as
an escape hatch if tenant permissions block an Azure Bot.

## Architecture

```
        Microsoft Teams
              │  (user @mentions an agent)
              ▼
   Azure Bot Service ──HTTPS──► tunnel ──► Fastify server
                                              │
   ┌──────────────────────────────────────────┼───────────────────────────┐
   │  agent-hub server (apps/server)           │                           │
   │                                           ▼                           │
   │  POST /api/messages ──► TeamsBot (botbuilder ActivityHandler)         │
   │     • CloudAdapter validates inbound JWT                              │
   │     • removeRecipientMention → parse "<slug>: <input>"               │
   │     • allowlist check (from.aadObjectId)                             │
   │     • store conversationReference on the run (replyTo)               │
   │     • RunRepository.create(trigger:'teams')                          │
   │                                           │                           │
   │  POST /api/runs/:id/result ──► ResultDispatcher ──► 'teams' output    │
   │     • Teams-originated run → reply to run.replyTo                     │
   │     • other run → agent.teamsTarget channel                          │
   │           both via TeamsNotifier.continueConversationAsync()         │
   └───────────────────────────────────────────────────────────────────────┘
              │                                    ▲
              ▼                                    │
   runner (unchanged) ── polls /api/runs/next, executes Claude, posts result
```

Everything new is **server-side** (`apps/server`). The runner, executor, and existing
GitLab/Jira webhook paths are unchanged — which also avoids the CrowdStrike/`claude.exe`
spawn constraints entirely (no new child processes).

The `CloudAdapter` is constructed once at app startup from the Entra credentials and shared
between the inbound route and the outbound `TeamsNotifier`. Note `ResultDispatcher` is
currently constructed *per result POST* (`runs.ts:105`), not at startup — so the singleton
`TeamsNotifier` is built once at startup and **injected into each per-request dispatcher**
(rather than rebuilding the adapter every request).

## Components

| Component | File | Responsibility |
|---|---|---|
| Teams route | `apps/server/src/api/routes/teams.ts` | `POST /api/messages`; hands raw req/res to `CloudAdapter.process`. Single purpose: bridge Fastify ↔ botbuilder. |
| `TeamsBot` | `apps/server/src/services/TeamsBot.ts` | `ActivityHandler` subclass. `onMessage`: parse, allowlist, store conv ref, create run. Handles `help` and `set-channel <slug>` commands. |
| `TeamsNotifier` | `apps/server/src/services/TeamsNotifier.ts` | Wrapper around `adapter.continueConversationAsync(appId, ref, …)` for outbound replies / proactive posts. Consumed by `ResultDispatcher`. |
| `teams` output | edit `apps/server/src/services/ResultDispatcher.ts` | New branch alongside `pr_comment` / `jira`. |
| Agent config UI | `apps/client/src/pages/AgentConfigPage.tsx` (+ outputs selector) | `teams` checkbox; read-only indicator of whether `teamsTarget` is set. |
| Teams app package | `apps/server/teams-app/` | `manifest.json` + 2 icons, zipped for sideloading. |

## Data Model

Drizzle schema (`apps/server/src/db/schema.ts`) + new migration `0005_*.sql`. **No runtime
migrator exists** — the plan includes a manual `ALTER TABLE` step against
`apps/server/agent-hub.db` (stop server first for the write lock).

**`agents`** — new column:
- `teamsTarget` (text, nullable) — JSON `ConversationReference` for this agent's report
  channel. Populated by `@AgentHub set-channel <slug>` run in the target channel (no manual
  JSON). `teams` is added as a value in the existing `outputs` JSON array.

**`runs`** — new column:
- `replyTo` (text, nullable) — JSON `ConversationReference` captured at trigger time for
  Teams-originated runs. Null for webhook/manual runs.
- **`RunRepository.create` must be extended too:** its current `Pick<RunRow, 'agentId' |
  'trigger' | 'triggerPayload' | 'context'>` signature and fixed insert field list silently
  drop `replyTo`. Add `replyTo` to the accepted fields and the inserted row.

**Agent slug source:** the inbound parser resolves agents by slug, but `AgentRow` has no
dedicated `slug` column. The plan must decide: reuse an existing identity field (e.g. a
normalized `name`) or add a `slug` column. Default: a **new `slug` column** on `agents`
(third schema change), populated from the agent name, unique — avoids ambiguous matching.

**`trigger` value:** `'teams'` is added alongside `'webhook' | 'manual'`. If `trigger` is a
constrained TypeScript union or DB check constraint anywhere, widen it.

**Migration safety:** since migrations are applied by hand (no runtime migrator), add a
startup assertion that the new columns exist when the Teams feature is enabled, so a
forgotten `ALTER TABLE` fails loudly with a clear message rather than as an opaque Drizzle
error on the first Teams message.

**Dispatch routing** (in `ResultDispatcher`, `teams` branch):
1. `run.replyTo` set → reply there (conversational case).
2. else `agent.teamsTarget` set → post there (reporting case).
3. else → no-op + warning log.

## Configuration

New env vars (`apps/server/src/config/environment.ts`, `.env`, `.env.example`):

| Var | Purpose |
|---|---|
| `MICROSOFT_APP_ID` | Entra app (bot) client ID |
| `MICROSOFT_APP_PASSWORD` | client secret |
| `MICROSOFT_APP_TENANT_ID` | Global-E tenant ID |
| `MICROSOFT_APP_TYPE` | `SingleTenant` (recommended) |
| `TEAMS_ALLOWED_USER_IDS` | comma-separated Entra object IDs allowed to trigger agents |

**Feature gate:** if `MICROSOFT_APP_ID` is unset, the route + notifier are not registered —
the feature is fully off, consistent with the repo's "no leak when disabled" convention.
Secrets live in `.env` alongside `GITLAB_API_TOKEN` etc.

## Inbound Flow (Teams → run)

Endpoint `POST /api/messages` (registered as the bot's messaging endpoint in Azure via the
tunnel). Fastify handler → `CloudAdapter.process(req, res, ctx => bot.run(ctx))`. The
adapter validates the inbound JWT — rejecting anything not signed by Bot Service.

`TeamsBot.onMessage` pipeline:
1. **Allowlist gate** — `activity.from.aadObjectId` ∈ `TEAMS_ALLOWED_USER_IDS`, else decline.
2. **Strip mention** — `TurnContext.removeRecipientMention(activity)`.
3. **Parse** — first token = slug, remainder = input (`<slug>: <input>` or `<slug> <input>`).
   Reserved commands handled before slug lookup:
   - `help` / empty → reply with list of available agent slugs.
   - `set-channel <slug>` → capture `getConversationReference`, save to that agent's
     `teamsTarget`, confirm.
4. **Resolve agent** — lookup by slug (add slug lookup to `AgentRepository`); no match /
   archived → error + help.
5. **Capture reply target** — `getConversationReference(activity)` → run's `replyTo`.
6. **Create run** — `RunRepository.create({ agentId, trigger:'teams', triggerPayload,
   context: <input>, replyTo })`. `trigger:'teams'` is a new trigger value.
7. **Ack** — *after* the run is created, send an immediate "🚀 Running `<slug>`…" reply.
   Ack failure is logged but non-fatal (the run already exists; the result will still post
   later) — consistent with the outbound `.catch` contract.

Parser robustness: `removeRecipientMention` can leave residual `<at>` markup / leading
whitespace, and behaves differently in personal vs. channel scope. The parser must trim
robustly; both scopes are covered by parser unit tests.

The input text becomes the run's `context` (piped to Claude via stdin by the executor).
Threading: the conversation reference carries the thread id, so ack + result land in-thread.

**v1 scope note:** input is the raw text only — no thread-context ingestion.

## Outbound Flow (run → Teams)

Trigger point unchanged: `POST /api/runs/:id/result` already calls
`dispatcher.dispatch(run, agent)` after `RunRepository.complete` (`runs.ts:104`).

`ResultDispatcher`:
- Constructor gains an injected `TeamsNotifier` (skipped if feature gated off).
- New branch:

```ts
if (output === 'teams' && this.teams) {
  const ref = run.replyTo ?? agent.teamsTarget;
  if (ref) {
    await this.teams.post(JSON.parse(ref), formatResult(run.result, agent))
      .catch(e => console.error('[ResultDispatcher] teams failed:', e));
  } else {
    console.warn('[ResultDispatcher] teams output set but no target for agent', agent.id);
  }
}
```

`TeamsNotifier.post(ref, text)` wraps
`adapter.continueConversationAsync(MICROSOFT_APP_ID, ref, ctx => ctx.sendActivity(text))`
— proactive messaging, exactly what a finished async run needs.

`formatResult`: v1 posts a plain message (Teams Markdown subset), sensibly capped. Adaptive
Cards are phase-2 polish.

## Auth

- **Inbound** — `CloudAdapter` validates the Bot Service JWT (from `MICROSOFT_APP_*`).
- **Outbound** — the same adapter acquires an Entra client-credentials token to call the
  Connector API at the conversation's `serviceUrl`. No token-handling code of our own.
- **App-level gate** — the allowlist on top of tenant auth.

## Provisioning & Permission Discovery

The plan's **first task is a discovery spike** (before code):
1. Attempt to create an **Azure Bot** + **Entra app registration** (single-tenant); record
   App ID / secret / tenant ID.
2. Check whether **custom Teams app sideloading** is enabled for the account.

Outcomes:
- **Unblocked** → proceed with approach A.
- **Blocked** → produce an escalation packet for IT (resource names, bot type, messaging
  endpoint URL, required permissions, sideloading request). Hub-side code is identical
  regardless; only credentials are pending. Fallback **C (Power Automate bridge)** remains
  available if an Azure Bot is refused outright.

**Teams app package:** minimal `manifest.json` + 2 icons, zipped and sideloaded, declaring
the bot (`botId = MICROSOFT_APP_ID`) with `personal` + `team` scopes.

**Dev loop:** cloudflared tunnel (same as GitLab webhooks) → set tunnel `/api/messages` as
the Azure messaging endpoint → sideload the app → DM the bot.

## Error Handling

- Inbound: unauthorized → polite decline; unknown slug → help; parse failure → usage hint.
  Adapter `onTurnError` → logged, generic apology, never crashes the route.
- Outbound: per-output `.catch` (logged), never fails the run — same contract as
  `pr_comment` / `jira`.
- Feature fully gated by `MICROSOFT_APP_ID`.

## Testing

- **Unit (Jest, `apps/server/test/`):** message parser (slug/input/commands), allowlist
  gate, dispatch routing (`replyTo` vs `teamsTarget` vs none), `set-channel` capture.
- **Integration:** `TeamsBot.onMessage` with mocked `TurnContext` → asserts run created with
  correct `replyTo`; `ResultDispatcher` `teams` branch with mocked `TeamsNotifier`.
- **Manual E2E:** DM bot → run executes → result posts in-thread; `set-channel` → webhook
  run reports to that channel. The botbuilder boundary is mocked in automated tests.

## Out of Scope (v1 / YAGNI)

- Agent-to-agent messaging (schema is designed to allow it later; not built now).
- Adaptive Card result formatting.
- Thread-context ingestion.
- Multi-tenant support.

## Open Questions

- None blocking. Confirm the Entra app type is `SingleTenant` during the discovery spike.
