# VWO Liveness Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native in-process VWO monitor with a runner-driven agent-hub agent (visible in the Agents screen) that curls the CheckoutService field-validations endpoint daily, reads the `x-vwo-campaigns` header, and reports LIVE/DOWN to Teams.

**Architecture:** Three changes: (1) grant the runner `Bash(curl:*)` gated behind a new `AGENT_CURL_ENABLED` flag; (2) remove the native monitor merged earlier; (3) a committed idempotent seed script that creates the agent DB record. Runs on the existing scheduler + runner + `teams_webhook` output — no new services.

**Tech Stack:** TypeScript. `packages/runner` uses **vitest**; `apps/server` uses **jest**. Both build via `tsc` and run from `dist/`.

## Global Constraints

- New env flag `AGENT_CURL_ENABLED` — default **OFF**; truthy only when in `['true','1','yes']` (note: OPPOSITE default from `AGENT_TOOLS_ENABLED`, which defaults on). When off, `buildToolArgs` output is byte-identical to today.
- Curl grant is `"Bash(curl:*)"`, double-quoted via the existing `q()` (shell:true spawn). Appended to the allowed list ONLY when `curlEnabled` is true and `enabled` is true.
- Agent record: `name` = `VWO Liveness — ShippingAddressValidation`, `type` = `pr-review` (enum formality; no type-specific path runs on a cron trigger), `model` = `claude-haiku-4-5`, `triggerRules` = `{events:[],cron:'0 9 * * *'}`, `repos` = `[]`, `outputs` = `['teams_webhook']`, `enabled` = true.
- Endpoint (in the agent prompt): `https://checkout-service-qa-hf.bglobale.com/api/v1/Shopify/field-validations-and-mapping-rules?merchantId=30000603&countryCode=US&cultureCode=en-US`, header `Origin: https://extensions.shopifycdn.com`. Curl uses `-sS -D - -o /dev/null` (Git Bash on the runner host).
- LIVE = HTTP 200 AND `x-vwo-campaigns` contains an entry with `CampaignKey=ShippingAddressValidation` (any Variation). Final agent output is exactly one line: `✅ LIVE — ShippingAddressValidation variation=<v>, HTTP 200` or `❌ DOWN — <reason>`.
- Seed script lives under `apps/server/src/scripts/` (so the existing `tsc` include compiles it to `dist/scripts/`); it must NOT run on import — guard `main()` with `if (require.main === module)`.
- Keep the prior native-monitor spec/plan docs and `verify-vwo-shipping-address-validation.sh`. Remove all native-monitor CODE, wiring, env, and tests.
- TDD. Runner single test: `npm test -- test/<f>.test.ts` (vitest). Server single test: `npm test -- test/<f>.test.ts` (jest). Imports use the `.js` extension.

---

### Task 1: Gate curl behind `AGENT_CURL_ENABLED` (packages/runner)

**Files:**
- Modify: `packages/runner/src/toolPolicy.ts`
- Modify: `packages/runner/src/config.ts`
- Modify: `packages/runner/src/executor.ts`
- Modify: `packages/runner/src/poller.ts`
- Test: `packages/runner/test/toolPolicy.test.ts` (extend)

**Interfaces:**
- Produces: `buildToolArgs({ enabled, repoPaths, curlEnabled? })` — appends `"Bash(curl:*)"` when `curlEnabled`. `RunnerConfig.curlEnabled: boolean`.
- Consumes: `AGENT_CURL_ENABLED` env.

- [ ] **Step 1: Write the failing test** — append to `packages/runner/test/toolPolicy.test.ts`:

```ts
  it('includes Bash(curl:*) only when curlEnabled is true', () => {
    const on = buildToolArgs({ enabled: true, repoPaths: ['/a'], curlEnabled: true });
    expect(on).toContain('"Bash(curl:*)"');
    expect(buildToolArgs({ enabled: true, repoPaths: ['/a'] })).not.toContain('"Bash(curl:*)"');
    expect(buildToolArgs({ enabled: true, repoPaths: ['/a'], curlEnabled: false })).not.toContain('"Bash(curl:*)"');
  });

  it('returns [] when disabled even if curlEnabled is true', () => {
    expect(buildToolArgs({ enabled: false, repoPaths: ['/a'], curlEnabled: true })).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/runner`): `npm test -- test/toolPolicy.test.ts`
Expected: FAIL — `curlEnabled` not accepted / `"Bash(curl:*)"` absent.

- [ ] **Step 3: Implement `toolPolicy.ts`** — replace the file body with:

```ts
export interface ToolArgsOptions {
  enabled: boolean;
  repoPaths: string[];
  curlEnabled?: boolean;
}

// Read-only built-ins + read-only git subcommands only.
const ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob',
  'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git status:*)',
  'Bash(git blame:*)', 'Bash(git ls-files:*)', 'Bash(git branch:*)', 'Bash(git rev-parse:*)',
];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// The spawn uses shell:true, so tokens with spaces/parens/globs/colons must be
// double-quoted (the shell strips the quotes before the arg reaches `claude`).
const q = (s: string): string => `"${s}"`;

export function buildToolArgs({ enabled, repoPaths, curlEnabled = false }: ToolArgsOptions): string[] {
  if (!enabled) return [];
  // curl is gated: only granted when AGENT_CURL_ENABLED is on. When granted it applies
  // to EVERY agent (the allowlist is global) — a documented trade-off.
  const allowed = curlEnabled ? [...ALLOWED_TOOLS, 'Bash(curl:*)'] : ALLOWED_TOOLS;
  const args: string[] = [
    '--permission-mode', 'dontAsk',
    '--allowedTools', ...allowed.map(q),
    '--disallowedTools', ...DISALLOWED_TOOLS.map(q),
  ];
  for (const path of repoPaths.slice(1)) {
    args.push('--add-dir', q(path));
  }
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/toolPolicy.test.ts`
Expected: PASS (original 5 + 2 new).

- [ ] **Step 5: Wire the flag through config → executor → poller**

In `packages/runner/src/config.ts`, add to the `RunnerConfig` interface after `toolsEnabled: boolean;`:
```ts
  curlEnabled: boolean;
```
and in the returned object of `loadConfig()`, after the `toolsEnabled:` line:
```ts
    curlEnabled: ['true', '1', 'yes'].includes((process.env.AGENT_CURL_ENABLED ?? '').trim().toLowerCase()),
```

In `packages/runner/src/executor.ts`, change the `executeJob` signature (line ~162) to add `curlEnabled` after `runEventsEnabled` and before `onProgress`:
```ts
export async function executeJob(
  job: Job, localReposRoot: string, skillsDir: string, workflowsDir: string,
  memory: MemoryInput, toolsEnabled: boolean, runEventsEnabled: boolean = false,
  curlEnabled: boolean = false, onProgress?: OnProgress,
): Promise<...> {
```
and the `buildToolArgs` call (line ~192):
```ts
  const toolArgs = buildToolArgs({ enabled: toolsEnabled, repoPaths, curlEnabled });
```

In `packages/runner/src/poller.ts`, update the sole `executeJob` call (line ~71) to pass `config.curlEnabled` before `onProgress`:
```ts
        const outcome = await executeJob(job, config.localReposRoot, config.skillsDir, config.workflowsDir, memory, config.toolsEnabled, config.runEventsEnabled, config.curlEnabled, onProgress);
```

- [ ] **Step 6: Type-check + full runner tests**

Run (from `packages/runner`): `npx tsc --noEmit` → Expected: no errors (catches any other `executeJob` caller).
Run: `npm test` → Expected: all runner tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/runner/src/toolPolicy.ts packages/runner/src/config.ts packages/runner/src/executor.ts packages/runner/src/poller.ts packages/runner/test/toolPolicy.test.ts
git commit -m "feat(runner): gate Bash(curl:*) behind AGENT_CURL_ENABLED (default off)"
```

---

### Task 2: Remove the native in-process monitor (apps/server)

**Files:**
- Delete: `apps/server/src/services/monitoring/vwoMonitorConfig.ts`, `probe.ts`, `stateMachine.ts`, `VwoAbMonitor.ts`
- Delete: `apps/server/test/vwoMonitor/vwoMonitorConfig.test.ts`, `probe.test.ts`, `stateMachine.test.ts`, `vwoAbMonitor.test.ts`, `startup.test.ts` (the whole `test/vwoMonitor/` dir)
- Modify: `apps/server/src/index.ts` (remove the import + call)
- Modify: `.env.example` (remove the `VWO_MONITOR_*` block)

**Interfaces:** none produced; this removes code.

- [ ] **Step 1: Delete the monitor source, tests, and startup wiring together**

Delete the four `src/services/monitoring/*.ts` files and the entire `apps/server/test/vwoMonitor/` directory (delete the tests in the SAME step as the `index.ts` revert so the suite never sees a dangling `startVwoMonitor` import).

```bash
git rm apps/server/src/services/monitoring/vwoMonitorConfig.ts \
       apps/server/src/services/monitoring/probe.ts \
       apps/server/src/services/monitoring/stateMachine.ts \
       apps/server/src/services/monitoring/VwoAbMonitor.ts
git rm -r apps/server/test/vwoMonitor
```

In `apps/server/src/index.ts`, remove the import line:
```ts
import { startVwoMonitor } from './services/monitoring/VwoAbMonitor.js';
```
and remove the call inside the `listen` callback so it returns to:
```ts
  startScheduler();
  app.log.info('Scheduler started');
```

- [ ] **Step 2: Remove the env block**

In `.env.example` (repo root), delete the VWO monitor comment + the five `VWO_MONITOR_*` lines added by the previous feature.

- [ ] **Step 3: Type-check + full server suite (confirms nothing else referenced the monitor)**

Run (from `apps/server`): `npx tsc --noEmit` → Expected: no errors.
Run: `npm test` → Expected: all suites pass, and the `vwoMonitor` suites are gone (no `Cannot find module` failures).

- [ ] **Step 4: Commit**

```bash
git add -A apps/server/src/index.ts .env.example
git commit -m "refactor(vwo): remove native in-process monitor in favor of runner-driven agent"
```

---

### Task 3: Seed script for the VWO agent record (apps/server)

**Files:**
- Create: `apps/server/src/scripts/seed-vwo-agent.ts`
- Test: `apps/server/test/seedVwoAgent.test.ts`

**Interfaces:**
- Produces: `buildVwoAgentInput(): AgentInsert` (pure, exported) and `VWO_AGENT_NAME` constant. A guarded `main()` that upserts by slug.

- [ ] **Step 1: Write the failing test** — create `apps/server/test/seedVwoAgent.test.ts`:

```ts
import { buildVwoAgentInput, VWO_AGENT_NAME } from '../src/scripts/seed-vwo-agent.js';

describe('buildVwoAgentInput', () => {
  const a = buildVwoAgentInput();

  it('sets identity + model + type', () => {
    expect(a.name).toBe(VWO_AGENT_NAME);
    expect(a.type).toBe('pr-review');
    expect(a.model).toBe('claude-haiku-4-5');
    expect(a.enabled).toBe(true);
  });

  it('sets a daily cron trigger, empty repos, and teams_webhook output (as JSON strings)', () => {
    expect(JSON.parse(a.triggerRules)).toEqual({ events: [], cron: '0 9 * * *' });
    expect(JSON.parse(a.repos)).toEqual([]);
    expect(JSON.parse(a.outputs)).toEqual(['teams_webhook']);
  });

  it('prompt tells the agent to curl the endpoint and read the x-vwo-campaigns header', () => {
    expect(a.prompt).toContain('field-validations-and-mapping-rules');
    expect(a.prompt).toContain('x-vwo-campaigns');
    expect(a.prompt).toContain('ShippingAddressValidation');
    expect(a.prompt).toContain('curl -sS -D -');
    expect(a.prompt).toContain('✅ LIVE');
    expect(a.prompt).toContain('❌ DOWN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/server`): `npm test -- test/seedVwoAgent.test.ts`
Expected: FAIL — cannot find module `../src/scripts/seed-vwo-agent.js`.

- [ ] **Step 3: Write the seed script** — create `apps/server/src/scripts/seed-vwo-agent.ts`:

```ts
import { AgentRepository, type AgentInsert } from '../services/AgentRepository.js';
import { slugify } from '../services/teams/slugify.js';
import { getDb } from '../db/client.js';
import { loadConfig } from '../config/environment.js';

export const VWO_AGENT_NAME = 'VWO Liveness — ShippingAddressValidation';

const ENDPOINT =
  'https://checkout-service-qa-hf.bglobale.com/api/v1/Shopify/field-validations-and-mapping-rules' +
  '?merchantId=30000603&countryCode=US&cultureCode=en-US';

const PROMPT = `You are a scheduled liveness monitor for the "ShippingAddressValidation" VWO A/B campaign on GlobalE checkout.

Run EXACTLY this command (it prints the response headers, then discards the body):

  curl -sS -D - -o /dev/null -H 'Origin: https://extensions.shopifycdn.com' '${ENDPOINT}'

Then inspect the response:
- Read the HTTP status line and the \`x-vwo-campaigns\` response header.
- The campaign is LIVE if the status is 200 AND \`x-vwo-campaigns\` is present and contains an entry whose "CampaignKey" is "ShippingAddressValidation" (ANY "Variation" value — Control or Variation-1 — counts as live).

Output EXACTLY ONE final line and nothing else, in one of these forms:
- \`✅ LIVE — ShippingAddressValidation variation=<Variation>, HTTP 200\`
- \`❌ DOWN — <reason>\`  where <reason> is one of: "HTTP <code>" (non-200), "x-vwo-campaigns header missing", "campaign not in header", or "curl failed: <short error>".

Do not invent or assume values — report only what the actual response shows. Do not run any other commands.`;

export function buildVwoAgentInput(): AgentInsert {
  return {
    name: VWO_AGENT_NAME,
    type: 'pr-review',
    model: 'claude-haiku-4-5',
    prompt: PROMPT,
    repos: '[]',
    triggerRules: JSON.stringify({ events: [], cron: '0 9 * * *' }),
    outputs: JSON.stringify(['teams_webhook']),
    enabled: true,
    title: 'VWO liveness (daily)',
    bio: 'Daily curl check that the ShippingAddressValidation VWO campaign is still served; posts LIVE/DOWN to the Agent-hub Teams channel.',
  };
}

function main(): void {
  const config = loadConfig();
  getDb(config.DATABASE_URL);
  const input = buildVwoAgentInput();
  const existing = AgentRepository.findBySlug(slugify(VWO_AGENT_NAME));
  if (existing) {
    AgentRepository.update(existing.id, input);
    console.log(`[seed-vwo-agent] updated existing agent ${existing.id}`);
  } else {
    const row = AgentRepository.create(input);
    console.log(`[seed-vwo-agent] created agent ${row.id}`);
  }
}

// Only run when executed directly (node dist/scripts/seed-vwo-agent.js),
// never on import (so tests can import buildVwoAgentInput without a DB).
if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/seedVwoAgent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check + commit**

Run (from `apps/server`): `npx tsc --noEmit` → Expected: no errors.

```bash
git add apps/server/src/scripts/seed-vwo-agent.ts apps/server/test/seedVwoAgent.test.ts
git commit -m "feat(vwo): seed script for the runner-driven VWO liveness agent"
```

---

## Manual verification (after all tasks — the real proof)

1. Build: `npx tsc` in `packages/runner` AND `apps/server`.
2. In root `.env`: set `AGENT_CURL_ENABLED=true`, ensure `AGENT_TOOLS_ENABLED` is on (default), and `TEAMS_WEBHOOK_URL` is set.
3. Restart the server (`:3000` owner) and the runner from fresh dist.
4. Seed the agent: `node dist/scripts/seed-vwo-agent.js` (from `apps/server`). Confirm `VWO Liveness — ShippingAddressValidation` appears in the Agents screen (localhost:5173).
5. Trigger a run: either temporarily set the agent's cron to `*/2 * * * *`, or POST a manual run. Confirm the run completes and a card lands in the Agent-hub Teams channel whose body shows `✅ LIVE — … variation=…` (or `❌ DOWN — …`).
6. Confirm curl is gated: set `AGENT_CURL_ENABLED=false`, restart the runner, trigger again → the agent can no longer curl (reports it couldn't fetch). Re-enable for normal operation.
7. Reset the cron to `0 9 * * *`.

## Global self-review checklist (done during authoring)

- Spec coverage: gated curl (Task 1), native-monitor removal incl. tests+wiring+env (Task 2), seeded daily agent with teams_webhook (Task 3), reproducible/idempotent seed (Task 3), live verification incl. gate-off check — all covered.
- Type consistency: `curlEnabled` threaded config→executor→poller with matching positional order; `buildToolArgs` option name matches test; `buildVwoAgentInput` returns `AgentInsert` (JSON-string fields) matching `AgentRepository.create`.
- No placeholders: every step has complete code and exact commands.
```
