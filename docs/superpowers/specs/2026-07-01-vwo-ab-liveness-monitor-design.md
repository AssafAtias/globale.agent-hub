# VWO A/B Liveness Monitor — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Repo:** `globale.agent-hub` (`apps/server`)
**Author:** Assaf (via Claude Code)

## Problem

The checkout **ShippingAddressValidation** VWO A/B test drives the shipping-address
field-validation rules served by CheckoutService
(`GET /api/v1/Shopify/field-validations-and-mapping-rules`). When the campaign is
live the response carries an `x-vwo-campaigns` header, e.g.:

```
x-vwo-campaigns: [{"CampaignKey":"ShippingAddressValidation","Variation":"Variation-1"}]
```

The variation is assigned server-side by VWO, keyed on the sanitized `x-client-id`
(deterministic per client; `x-checkout-id` is irrelevant to bucketing —
`VwoService.Activate(campaignKey, sanitizedClientId, options)`).

There is currently **no automated signal** if the campaign silently stops being
returned — e.g. the campaign is paused/removed in VWO, the VWO settings file fails
to load, or the endpoint starts erroring. Today this is only caught by a human
manually opening a checkout and inspecting the response header.

We want a low-noise, automated **liveness** check that alerts the team when the
campaign stops being served, and confirms once a day that it is still healthy.

## Goals

- Once a day, verify the field-validations endpoint returns the
  `ShippingAddressValidation` campaign in the `x-vwo-campaigns` header.
- Alert the team (Agent-hub Teams channel) **immediately on failure** and again
  **on recovery**.
- Emit a **daily ✅ heartbeat** so a silent/healthy channel is unambiguous
  (no post ≠ healthy; a heartbeat = confirmed healthy).
- Be self-contained, deterministic, and cheap: **no LLM, no Claude runner, no
  subscription rate-limit usage, no tool-policy change.**

## Non-goals

- **Not** a full A/B correctness auditor. We are checking *liveness only*
  (campaign present). Split-ratio health, determinism, and checkout-id
  independence are explicitly out of scope for this monitor.
  (Those invariants were verified once, manually, via a standalone shell harness
  — see "Related artifacts".)
- **No dashboard run history.** Surfacing this as a `runs` row would require an
  `agentId` FK and a seeded "system" agent — coupling with no real payoff at
  daily cadence. Output is Teams + structured server logs.
- **No new DB table / migration.** agent-hub has no runtime migrator; state is
  in-memory (see Risks).
- **Not** a Claude agent record. It does not appear in the agents list and is not
  scheduled by the agent-driven `Scheduler`.

## Owners

- Implementation: checkout team (agent-hub maintainer).
- Runtime: runs inside the existing `apps/server` process.

## Approach

A self-contained server service, `VwoAbMonitor`, started from
`apps/server/src/index.ts` next to `startScheduler()`. It owns its own
`croner` `Cron` instance (the same lib the agent scheduler already uses) so it is
fully independent of the agent scheduling path and the runner.

### Why native (not a Claude agent)

The agent-hub runner's tool policy is a global, hardcoded read-only allowlist
(`Read`/`Grep`/`Glob` + a few `Bash(git …)` patterns; `toolPolicy.ts`). It has
**no `WebFetch` and no `curl`**, so a Claude agent cannot make the HTTP probe
without granting HTTP to *every* agent. The check is also fully deterministic
(fetch → header assert), so an LLM adds no value and would consume the shared,
rate-limited (429-prone) Claude subscription pool. A native check is simpler,
reliable, and free.

## Components

All under `apps/server/src/services/monitoring/`.

### 1. `probe.ts` — the HTTP probe (pure-ish, testable)

```
type ProbeResult =
  | { ok: true;  variation: string; httpStatus: 200; merchantId: number }
  | { ok: false; reason: 'non_200' | 'timeout' | 'network' | 'campaign_missing';
      httpStatus?: number; detail?: string; merchantId: number };

async function probeMerchant(cfg, merchant): Promise<ProbeResult>
```

- `fetch` the endpoint with `Origin: https://extensions.shopifycdn.com` and a
  ~10s `AbortController` timeout.
- On non-200 → `non_200`. On abort → `timeout`. On thrown error → `network`.
- On 200 → read `x-vwo-campaigns`, parse JSON, look for an entry whose
  `CampaignKey === cfg.campaignKey`. Found → `ok:true` with its `Variation`.
  Missing/unparseable → `campaign_missing`.
- `extractVariation(headerValue, campaignKey)` is a **pure** helper (unit-tested
  independently of `fetch`).

### 2. `stateMachine.ts` — decide what to post (pure)

```
type State  = 'unknown' | 'healthy' | 'failing';
type Action = 'none' | 'failure' | 'recovery' | 'heartbeat';   // bare string, single representation

function decide(prev: State, result: ProbeResult, isDailyTick: boolean): { next: State; action: Action }
```

`Action` is a bare string union (not an object) — this is the single canonical
representation used by the prose, tests, and `VwoAbMonitor`.

Rules (evaluated per run; at daily cadence each run is a "daily tick"):
- `result.ok === false` → `next='failing'`, `action='failure'`.
- `result.ok === true` and `prev === 'failing'` → `next='healthy'`,
  `action='recovery'`.
- `result.ok === true` and `isDailyTick` → `next='healthy'`, `action='heartbeat'`.
- otherwise → `next='healthy'`, `action='none'` (covers higher-cadence future use).

Because cadence is daily, every healthy run yields either `recovery` or
`heartbeat` — never silent. The `'none'` branch exists so the same logic behaves
sanely if `VWO_MONITOR_CRON` is later set to a higher frequency.

**Source of `isDailyTick`:** for this design `VwoAbMonitor.tick()` passes
`isDailyTick = true` unconditionally, because the cron fires once a day and every
fire is the daily tick. If a future change sets a sub-daily cron, `tick()` becomes
responsible for computing the flag (e.g. true only on the first tick of each
calendar day); the `decide` contract does not change. This keeps the `'none'`
branch reachable and unit-testable today even though production never hits it.

### 3. `VwoAbMonitor.ts` — orchestrator

- Reads config (below). If `enabled === false`, logs "disabled" and does nothing.
- Registers `new Cron(cfg.cron, () => this.tick())`.
- `tick()`: for each configured merchant, `probeMerchant` (with **one retry**
  after a short delay on a non-`campaign_missing` failure, to ride out transient
  blips), then `decide(prevState, result, /* isDailyTick */ true)`, update the
  merchant's in-memory state, and if `action !== 'none'` post the corresponding
  `buildVwoCard(...)` via the injected `TeamsWebhookNotifier` (each post wrapped in
  its own `.catch`). Always writes a structured log line (`app.log.info/warn`)
  regardless of whether it posts. Per-merchant state is keyed by merchant id.
- Wrapped so a thrown error in one merchant never breaks the tick or the server.

### 4. Card rendering

Add a dedicated `buildVwoCard(action, lines)` next to the existing
`buildAgentCard`. A dedicated builder is required because `buildAgentCard` only
models two visual states (`'done' | 'failed'`), whereas the monitor needs three
distinct cards — ✅ healthy (heartbeat), ✅ recovered, ❌ down — so "recovered"
reads differently from a routine heartbeat. The monitor posts the card by calling
`TeamsWebhookNotifier` with the pre-built card (or a thin method that accepts a
prepared card), and always wraps the post in its own `.catch` — `postResult`
itself throws on a non-2xx webhook response and does not swallow. Card content:
- Title: `VWO Liveness — ShippingAddressValidation`
- Status: ✅ healthy / ✅ recovered / ❌ down
- Per merchant: merchant id, variation seen (or failure reason), HTTP status.
- Timestamp (UTC).

## Configuration (env-driven; no code edit to tune)

```
VWO_MONITOR_ENABLED=true                                   # default false (opt-in)
VWO_MONITOR_BASE_URL=https://checkout-service-qa-hf.bglobale.com
VWO_MONITOR_CAMPAIGN_KEY=ShippingAddressValidation         # default
VWO_MONITOR_CRON=0 9 * * *                                 # default daily 09:00
VWO_MONITOR_MERCHANTS=30000603:US:en-US                    # comma-list of merchantId:country:culture
# reuses existing TEAMS_WEBHOOK_URL
```

`VWO_MONITOR_MERCHANTS` is a comma-separated list of `merchantId:countryCode:cultureCode`
tuples, defaulting to the single QA-HF entry `30000603:US:en-US`. This makes
adding PROD (or more merchants) later a config change, not a code change.

## Error handling

- All network faults map to a `ProbeResult` failure reason — never an unhandled
  throw.
- `tick()` iterates merchants in independent try/catch; one merchant failing to
  probe does not skip the others.
- Teams post failures are caught and logged (best-effort, matching the existing
  `ResultDispatcher` pattern) — a webhook outage must not crash the monitor.
- The whole service is guarded so it can never take down `apps/server`.

## Testing

Jest (agent-hub's existing setup), no live network:
- `extractVariation`: header present (Control / Variation-1), header missing,
  malformed JSON, wrong CampaignKey, and a **multi-entry** array where the target
  `CampaignKey` is one of several (must return the right variation).
- `decide`: unknown→healthy (heartbeat), healthy→failing (failure),
  failing→healthy (recovery), healthy→healthy non-daily (none).
- `probeMerchant`: `fetch` mocked for 200+header, 200+no-header, 500, and a
  thrown/aborted request → correct `ProbeResult`.
- `VwoAbMonitor.tick`: injected fake probe + fake notifier; assert the notifier
  is called with the right card type per transition, and not called on `none`.

## Deployment

Per agent-hub norms (server runs from `dist/`):
1. `npx tsc` in `apps/server`.
2. Add the `VWO_MONITOR_*` env vars to root `.env` (and confirm `TEAMS_WEBHOOK_URL`).
3. Restart `node dist/index.js` (the `:3000` listener).
4. No DB migration.
Verify by temporarily setting `VWO_MONITOR_CRON` to `* * * * *` (or exposing a
one-shot `runOnce()` guarded behind a test), confirming a ✅ card lands in the
channel, then reverting to the daily cron.

## Acceptance criteria

- With `VWO_MONITOR_ENABLED=true`, at 09:00 the monitor probes each configured
  merchant and posts exactly one card to the Agent-hub Teams channel:
  ✅ heartbeat when the campaign is live, ❌ failure otherwise.
- A transition from failing → live posts a ✅ recovery card on the next run.
- A transient single failure that succeeds on retry does **not** post a failure.
- `extractVariation` returns the correct variation when `x-vwo-campaigns` is an
  array containing multiple campaign entries alongside `ShippingAddressValidation`.
- `VWO_MONITOR_ENABLED=false` (or unset) → the service is inert (logs "disabled",
  registers no cron, posts nothing).
- Server starts and runs normally whether or not the endpoint / webhook is reachable.
- Unit tests cover `extractVariation`, `decide`, `probeMerchant`, and `tick`.

## Risks & tradeoffs

- **In-memory state**: per-merchant `healthy/failing` state is not persisted. A
  server restart resets every merchant to `unknown`. Because a healthy non-daily
  tick yields `action='none'`, after a restart a **healthy** endpoint stays silent
  until the next daily 09:00 heartbeat (no spurious post), while an **unhealthy**
  endpoint still posts a `failure` on the next tick (desired). The only cost of a
  restart is losing the "was failing" memory, so a recovery that spans a restart
  is reported as a routine heartbeat rather than an explicit "recovered" card.
  Accepted vs. adding a persistence table (no runtime migrator exists). Revisit
  only if cadence increases materially.
- **Single-region probe**: probing from the server's network only. A regional
  edge/CDN issue invisible to the server won't be caught. Out of scope.
- **Liveness ≠ correctness**: this does not detect split drift or bucketing bugs
  (explicit non-goal).

## Related artifacts

- One-off correctness verification (determinism, checkout-id independence,
  ~50/50 split) proven manually via `verify-vwo-shipping-address-validation.sh`
  (a bash + curl harness). That harness stays as an on-demand tool; this monitor
  is the ongoing liveness signal.
- CheckoutService assignment logic:
  `GlobalE.Checkout.CheckoutService.Services/VWO/VwoService.cs`,
  `.../AbTests/AbTestService.cs`.
- agent-hub building blocks reused: `croner` scheduler pattern (`index.ts` /
  `services/Scheduler.ts`), `services/teams/TeamsWebhookNotifier.ts`.
