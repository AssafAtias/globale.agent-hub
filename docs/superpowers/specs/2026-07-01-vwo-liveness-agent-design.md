# VWO Liveness as a Runner-Driven Agent — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Repo:** `globale.agent-hub`
**Supersedes:** `2026-07-01-vwo-ab-liveness-monitor-design.md` (the native in-process monitor). That approach is being replaced, per user decision, by a real agent-hub agent so the check is visible and managed in the Agents screen.

## Problem

The VWO `ShippingAddressValidation` A/B campaign drives shipping-address field
validation via CheckoutService. We want an automated daily liveness check that
alerts the team when the campaign stops being served — AND the user wants it to
be a first-class **agent-hub agent**: visible in the Agents screen
(`localhost:5173`), scheduled by the agent scheduler, and executed by the runner
like every other agent.

The previously-built native in-process monitor works but is invisible in the
Agents UI by design. This design replaces it with a runner-driven agent.

## The feasibility constraint (why curl, not WebFetch)

The liveness signal is the **`x-vwo-campaigns` HTTP response header**. Claude
Code's `WebFetch` tool returns processed page *content* (markdown), not raw
response headers — so an agent cannot read the variation via WebFetch. The only
way an agent reads a response header is `curl -sS -D -` (dump headers) via the
Bash tool. Therefore this design grants the runner `Bash(curl:*)`.

The runner's tool allowlist (`packages/runner/src/toolPolicy.ts`) is a single
global constant with no per-agent scoping. Granting curl there gives **every**
agent curl. We gate it behind a new opt-in flag rather than scoping per agent
(per-agent scoping is a larger refactor, explicitly deferred — see Non-goals).

## Goals

- A daily (`0 9 * * *`) agent-hub agent, visible/enabled in the Agents screen,
  that curls the field-validations endpoint, reads `x-vwo-campaigns`, and posts
  a status to the Agent-hub Teams channel via the existing `teams_webhook` output.
- `curl` is available to the runner ONLY when a new `AGENT_CURL_ENABLED` flag is
  on (default off); no behavior change when off.
- The native in-process monitor is removed so there is exactly one implementation.

## Non-goals

- **Per-agent tool scoping.** Deferred. We use a single global gated flag. If the
  team later wants only the VWO agent to have curl, that is a separate refactor of
  `buildToolArgs`/executor to source tools from the agent record.
- **Distinct ✅/❌ card titles by check result.** The `teams_webhook` card title
  reflects RUN success/failure, not the check outcome. A "campaign down" finding is
  a *successful run*, so it posts as a ✅ "completed" card whose BODY says
  `❌ DOWN …`. Rendering down-checks as red cards would require changing
  `ResultDispatcher` or failing the run — out of scope.
- **Recovery/heartbeat state machine.** Each run reports current status only
  (the LLM has no persisted prior state). No "recovered" transition.
- **Deterministic parsing / zero-quota.** This is an LLM agent by the user's
  explicit choice; it uses the shared Claude subscription quota per run.

## Owners

- Implementation: agent-hub maintainer. Runtime: server (scheduler) + runner (execution).

## Approach

### 1. Gated curl in the runner tool policy
- `packages/runner/src/toolPolicy.ts`: `buildToolArgs` gains a `curlEnabled: boolean`
  option. When true, `"Bash(curl:*)"` is appended to the allowed tools. `ALLOWED_TOOLS`
  stays as-is for the default set.
- `packages/runner/src/config.ts`: add `curlEnabled` derived from `AGENT_CURL_ENABLED`
  (same truthy parsing as the existing `toolsEnabled`/`AGENT_TOOLS_ENABLED`).
- The executor call site that builds tool args passes `curlEnabled` through.
- Net: `AGENT_CURL_ENABLED` unset/false → byte-identical to today. True → all agents
  may run curl.

### 2. Remove the native monitor
- Delete `apps/server/src/services/monitoring/{vwoMonitorConfig,probe,stateMachine,VwoAbMonitor}.ts`
  and `apps/server/test/vwoMonitor/*`.
- Revert the `startVwoMonitor` import + call in `apps/server/src/index.ts`.
- Remove the `VWO_MONITOR_*` block from `.env.example`.
- KEEP: `docs/superpowers/specs|plans/2026-07-01-vwo-ab-liveness-monitor*` (mark
  superseded by this doc), and the `verify-vwo-shipping-address-validation.sh` harness.

### 3. Seed the agent record (reproducible)
- `apps/server/scripts/seed-vwo-agent.ts`: a small idempotent script (upsert by name)
  that creates the agent via `AgentRepository.create` (or updates if it exists). Run
  once by the operator: `node dist/scripts/seed-vwo-agent.js` (after tsc). The
  canonical prompt lives in this committed script — reviewable, not hand-typed in UI.
- Agent record fields:
  - `name`: `VWO Liveness — ShippingAddressValidation`
  - `type`: `pr-review` (the record `type` enum only allows `pr-review`/`ticket-to-code`;
    on a cron trigger the type-specific webhook/context path never runs, so it is a
    formality with no behavioral effect).
  - `model`: `claude-haiku-4-5`
  - `triggerRules`: `{ events: [], cron: '0 9 * * *' }`
  - `repos`: `[]`
  - `outputs`: `['teams_webhook']`
  - `enabled`: `true`
  - `prompt`: instructs the agent to run
    `curl -sS -D - -o NUL -H 'Origin: https://extensions.shopifycdn.com' '<ENDPOINT>'`
    where ENDPOINT =
    `https://checkout-service-qa-hf.bglobale.com/api/v1/Shopify/field-validations-and-mapping-rules?merchantId=30000603&countryCode=US&cultureCode=en-US`,
    read the `x-vwo-campaigns` response header, and emit EXACTLY ONE final line:
    `✅ LIVE — ShippingAddressValidation variation=<Variation>, HTTP 200` when the
    header contains an entry with `CampaignKey=ShippingAddressValidation`, else
    `❌ DOWN — <reason: non-200 / header missing / campaign absent>`. The agent must
    not invent data; if curl fails, report the failure verbatim.

### 4. Reporting
- Reuses `teams_webhook` output → `ResultDispatcher` posts the agent's final text
  (`run.result`) as an Adaptive Card on completion. Requires `TEAMS_WEBHOOK_URL` set.

## Configuration

```
AGENT_CURL_ENABLED=false   # NEW: default off. When true, ALL agents may run Bash(curl:*).
# reuses existing TEAMS_WEBHOOK_URL and AGENT_TOOLS_ENABLED (must be on for any tools)
```

## Error handling

- curl unreachable / non-200 / header missing → the agent reports `❌ DOWN — <reason>`
  as its normal (successful-run) output; the card body carries the verdict.
- If the runner/CLI errors (e.g. curl not on PATH), the run fails and `ResultDispatcher`
  posts a ❌ "failed" card with the error (failure post gated on `teams_webhook` in outputs).
- `AGENT_CURL_ENABLED=false` → the agent cannot curl; the run will report inability to
  fetch. This is the safe default state until the operator opts in.

## Testing

- Unit (`packages/runner`): `buildToolArgs` includes `"Bash(curl:*)"` iff `curlEnabled`,
  and excludes it otherwise; config maps `AGENT_CURL_ENABLED` truthy values.
- Unit (`apps/server`): seed script builds the expected agent payload (name, type,
  cron, outputs, model) — test the pure payload-builder, not a live DB insert.
- Live verification (the real proof — LLM behavior isn't unit-testable):
  1. `npx tsc` in `packages/runner` and `apps/server`; set `AGENT_CURL_ENABLED=true`
     and `AGENT_TOOLS_ENABLED=true` (+ `TEAMS_WEBHOOK_URL`) in root `.env`.
  2. Restart server (`:3000`) and runner from fresh dist.
  3. Seed the agent (`node dist/scripts/seed-vwo-agent.js`); confirm it appears in the
     Agents screen.
  4. Trigger a manual run (or set cron to `*/2 * * * *` temporarily); confirm the run
     completes and a card lands in the Agent-hub Teams channel with the LIVE/DOWN line.
  5. Revert cron to `0 9 * * *`.

## Deployment (agent-hub norms)

- Both server and runner run from `dist/` — `npx tsc` in each changed workspace, then
  restart both processes. Verify runner picks up the new toolPolicy (rebuild
  `packages/runner`). No DB migration (agents table already exists).

## Acceptance criteria

- With `AGENT_CURL_ENABLED=false` (default), `buildToolArgs` output is byte-identical
  to before; no agent can curl.
- With `AGENT_CURL_ENABLED=true`, the seeded VWO agent appears in the Agents screen,
  fires on its cron, curls the endpoint, and posts a card whose body states LIVE
  (with variation) or DOWN (with reason).
- The native in-process monitor and its tests/wiring/env are fully removed; the full
  `apps/server` suite still passes and `tsc` is clean in both workspaces.
- The curl harness and prior spec/plan docs remain (docs marked superseded).

## Risks & tradeoffs

- **Blast radius:** when `AGENT_CURL_ENABLED=true`, every agent can run arbitrary
  `curl` (SSRF/exfiltration surface). Mitigation: default off; the flag is the control;
  documented. Per-agent scoping is the eventual correct fix (deferred).
- **curl on PATH (Windows):** the runner host must have `curl` available to the shell
  the CLI Bash tool uses. Windows 11 ships `curl.exe`; the live test confirms it. The
  prompt uses `-o NUL` (Windows null device); the plan notes `/dev/null` if the shell
  is POSIX.
- **Empty `repos: []` on a scheduled run:** the runner sets cwd from the repo list; the
  plan must verify an empty list is tolerated, else point the agent at a harmless repo.
- **LLM variance/quota:** a trivial check runs through the shared subscription pool;
  haiku keeps cost/latency low but output wording may vary (the prompt pins the final
  line format to keep the card legible).
