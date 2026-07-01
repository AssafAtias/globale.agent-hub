# VWO Traffic Generator (repurposed agent) — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending plan
**Repo:** `globale.agent-hub`
**Related:** supersedes the liveness behavior of `2026-07-01-vwo-liveness-agent-design.md` — the same agent record is repurposed from a 1-call liveness check into a manual N-session traffic generator.

## Problem

The user wants to drive ~100 VWO checkout "sessions" on demand and SEE the result in the Agent Hub **Activity** view: how many calls were made, the Control/Variation-1 split, and the `clientId`/`checkoutId` generated. Each distinct `x-client-id` hitting the CheckoutService field-validations endpoint registers one VWO `Activate` impression (one visitor), so N distinct client-ids = N visitors on the campaign report.

The existing "VWO Liveness" agent does a single call — it can't show a multi-session summary. And the runner grants the agent `Bash(curl:*)` only (no shell loops), so the agent itself cannot loop 100 times cheaply.

## Goals

- Repurpose the existing agent into **VWO Traffic Generator — ShippingAddressValidation**, **manual-only** (no cron).
- One agent run fires **100** sessions (distinct `x-client-id` + `x-checkout-id`) and its Activity/result reports: total calls, the split (Variation-1 / Control / none), and the list of generated `clientId`/`checkoutId` with each one's variation.
- No new tool-policy grant: the agent makes **one `curl` to a localhost endpoint** (reuses the existing `AGENT_CURL_ENABLED` grant); the server does the looping.

## Non-goals

- **Keeping the daily liveness check.** Per user choice, this agent becomes the generator; the daily health-check is removed. (A separate liveness agent can be re-added later.)
- **Generating goal conversions.** The endpoint only triggers `Activate` (visitors), not the goal (G254). Conversions stay 0.
- **Per-agent tool scoping / broadening Bash.** Avoided by using a localhost endpoint + the existing curl grant.
- **Production use.** This hammers the QA-HF endpoint on demand; it is a dev/test tool, gated off by default.

## Approach

### 1. Session-generator core — `apps/server/src/services/vwo/generateSessions.ts`
Pure, testable (fetch injectable):
```
interface GeneratedSession { clientId: string; checkoutId: string; variation: string | null; }
interface GenerateResult { n: number; variation1: number; control: number; none: number; sessions: GeneratedSession[]; }
function extractVariation(header: string | null, campaignKey: string): string | null   // small local parser
async function generateVwoSessions(opts: {
  baseUrl: string; merchantId: number; countryCode: string; cultureCode: string;
  campaignKey: string; n: number; concurrency?: number;
}, fetchImpl?: typeof fetch, randomInt?: () => number): Promise<GenerateResult>
```
- Builds N distinct client-ids (`<rand>.<rand>.<merchantId>`) and checkout-ids (32-hex), fires the field-validations GET with `Origin` + `x-client-id` + `x-checkout-id`, parses `x-vwo-campaigns` for `campaignKey`, tallies. Runs with a small concurrency pool (default 10) so 100 finishes in a few seconds. `randomInt`/`fetchImpl` injectable for deterministic tests. Never throws per-session — a failed request → `variation: null` (counted as `none`).
- `extractVariation` is inlined here (the old `probe.ts` was removed with the native monitor).

### 2. Dev route — `apps/server/src/api/routes/devTools.ts`
`buildDevToolsRoutes(config)` → `FastifyPluginAsyncTypebox`, registered in `app.ts`:
- `GET /api/dev/vwo-generate-sessions` with TypeBox querystring `{ n?: integer }` (default 100, **clamped to [1, 500]**).
- If `config.VWO_GENERATE_ENABLED` is false → reply **404** (don't advertise the tool when off).
- Else call `generateVwoSessions(...)` with the baked QA-HF params (base `https://checkout-service-qa-hf.bglobale.com`, merchant `30000603`, `US`/`en-US`, campaign `ShippingAddressValidation`) and return the `GenerateResult` JSON.

### 3. Config — `apps/server/src/config/environment.ts`
Add `VWO_GENERATE_ENABLED: boolean` to `Environment`, parsed default-off (`['true','1','yes'].includes(...)`).

### 4. Repurpose the agent — update `apps/server/src/scripts/seed-vwo-agent.ts`
`buildVwoAgentInput()` becomes:
- `name`: `VWO Traffic Generator — ShippingAddressValidation` (VWO_AGENT_NAME updated).
- `triggerRules`: `{ events: [] }` — **no cron** (manual-only).
- `outputs`: `[]` (Activity-only; no Teams).
- `title`/`bio` updated to reflect the generator purpose.
- `prompt`: instruct the agent to run EXACTLY
  `curl -sS 'http://localhost:3000/api/dev/vwo-generate-sessions?n=100'`
  then parse the JSON and output a report: a header line `<n> calls · <variation1> Variation-1 / <control> Control / <none> none`, followed by one line per session `<clientId>  <checkoutId>  <variation>`. Do not invent data; if the endpoint errors (e.g. 404 = tool disabled), report that verbatim.
- `main()` still upserts by slug (idempotent) — re-running updates the existing record. (Because the name changes, note in the plan: the OLD record `VWO Liveness — …` won't match the new slug; the plan must delete/rename the old record so we don't end up with two. Simplest: `main()` also removes a stale `VWO Liveness — ShippingAddressValidation` record if present.)

## Configuration
```
VWO_GENERATE_ENABLED=false   # NEW: default off. Enables the /api/dev/vwo-generate-sessions route.
# reuses existing AGENT_CURL_ENABLED (agent curls localhost) + AGENT_TOOLS_ENABLED
```

## Error handling
- Per-session failures → `variation: null`, counted as `none`; the run still reports.
- Endpoint disabled (flag off) → 404; the agent reports it couldn't reach the tool.
- `n` out of range → clamped, not rejected.
- The generator never throws out of the route; the route wraps in try/catch → 500 with a message on unexpected failure.

## Testing
- `generateVwoSessions` (fetch + randomInt mocked): correct tallies for a scripted set of responses; N distinct client-ids; missing-header → none; respects n; concurrency doesn't drop/duplicate sessions (result length === n).
- `extractVariation`: present (Control/Variation-1), missing, malformed, wrong key, multi-entry.
- Route (Fastify `inject`): flag off → 404; flag on → 200 with the expected JSON shape (generator stubbed or fetch mocked).
- Seed: `buildVwoAgentInput()` → new name, no `cron` key in triggerRules, `outputs: []`, prompt contains the localhost endpoint + the report format.

## Deployment / activation (this one needs a server restart — new route)
1. `npx tsc` in `apps/server`.
2. Set `VWO_GENERATE_ENABLED=true` in root `.env` (AGENT_CURL_ENABLED already on).
3. **Restart the server** (:3000) from fresh dist — the new route only exists after restart.
4. Re-run the seed: `node dist/scripts/seed-vwo-agent.js` (renames the agent, removes cron, updates prompt; removes the stale liveness record).
5. In the Agents screen, hit **RUN** on **VWO Traffic Generator** → Activity shows the curl + the 100-session summary. No DB migration.

## Risks & tradeoffs
- **VWO data pollution:** each run injects 100 synthetic visitors into the real QA-HF campaign report. Manual-only + flag-gated limits this to intentional use.
- **Dev endpoint surface:** `/api/dev/vwo-generate-sessions` is unauthenticated but flag-gated (404 when off) and localhost-relevant; it fans out to an external QA endpoint. Acceptable for a gated dev tool; documented.
- **Loses the daily liveness signal** (accepted).
- **Server restart required** to activate the route (unlike the pure seed change).
