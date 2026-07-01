# VWO Traffic Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Repurpose the VWO agent into a manual traffic generator — one run fires 100 distinct-client-id sessions at the CheckoutService field-validations endpoint (via a gated localhost dev endpoint) and reports count + Control/Variation-1 split + the generated clientId/checkoutId list in Agent Hub Activity.

**Architecture:** A server-side generator (does the loop) + a flag-gated dev route the agent hits with ONE `curl` to localhost (reuses the existing `AGENT_CURL_ENABLED` grant — no new tool-policy change). The agent record is renamed in place to the generator, manual-only.

**Tech Stack:** apps/server (Fastify + TypeBox, jest). Node 18+ (global fetch). Runs from dist/.

## Global Constraints

- New flag `VWO_GENERATE_ENABLED` — default OFF (`['true','1','yes'].includes(...)`). Route replies **404** when off (flag checked inside the handler; route always registered).
- Endpoint (baked QA-HF params): base `https://checkout-service-qa-hf.bglobale.com`, merchant `30000603`, `US`/`en-US`, campaign `ShippingAddressValidation`, path `/api/v1/Shopify/field-validations-and-mapping-rules`, header `Origin: https://extensions.shopifycdn.com` + generated `x-client-id` + `x-checkout-id`.
- `generateVwoSessions` INVARIANT: always returns exactly `n` entries in `sessions`; `variation1 + control + none === n`; no dropped/duplicated sessions (index by position). Never throws per-session (failed request → `variation: null` → counted as `none`). Concurrency pool default 10, capped at `n`.
- `extractVariation(header, campaignKey)`: `x-vwo-campaigns` is a JSON array like `[{"CampaignKey":"ShippingAddressValidation","Variation":"Control"}]`; return the `Variation` of the first entry with matching `CampaignKey`, else `null` (also on absent/malformed/non-array).
- Dev route: `GET /api/dev/vwo-generate-sessions?n=100`; `n` optional, default 100, clamped to [1,500].
- Agent rename-in-place: new name `VWO Traffic Generator — ShippingAddressValidation` (slug `vwo-traffic-generator-shippingaddressvalidation`); old slug `vwo-liveness-shippingaddressvalidation`. `main()` = `findBySlug(new) ?? findBySlug(old)` → `update(existing.id, input)` else `create(input)`. No duplicate. triggerRules `{events:[]}` (NO cron = manual). outputs `[]`.
- TDD. Server single test: `npm test -- test/<f>.test.ts` (jest). Imports use `.js` extension.

---

### Task 1: Session generator core (apps/server)

**Files:**
- Create: `apps/server/src/services/vwo/generateSessions.ts`
- Test: `apps/server/test/vwo/generateSessions.test.ts`

**Interfaces:**
- Produces: `GeneratedSession`, `GenerateResult`, `extractVariation(header, campaignKey)`, `generateVwoSessions(opts, fetchImpl?, randomInt?)`.

- [ ] **Step 1: Write the failing test** — create `apps/server/test/vwo/generateSessions.test.ts`:

```ts
import { extractVariation, generateVwoSessions } from '../../src/services/vwo/generateSessions.js';

const KEY = 'ShippingAddressValidation';

describe('extractVariation', () => {
  it('returns the variation for a matching entry', () => {
    expect(extractVariation(`[{"CampaignKey":"${KEY}","Variation":"Variation-1"}]`, KEY)).toBe('Variation-1');
  });
  it('finds the target among multiple entries', () => {
    expect(extractVariation(`[{"CampaignKey":"Other","Variation":"A"},{"CampaignKey":"${KEY}","Variation":"Control"}]`, KEY)).toBe('Control');
  });
  it('returns null for missing / malformed / wrong-key / non-array', () => {
    expect(extractVariation(null, KEY)).toBeNull();
    expect(extractVariation('not json', KEY)).toBeNull();
    expect(extractVariation('[{"CampaignKey":"Other","Variation":"A"}]', KEY)).toBeNull();
    expect(extractVariation('{"CampaignKey":"x"}', KEY)).toBeNull();
  });
});

const opts = { baseUrl: 'https://cs.example.com', merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US', campaignKey: KEY, n: 5, concurrency: 2 };

function seqRandom() { let i = 0; return () => ++i; } // 1,2,3,... deterministic

describe('generateVwoSessions', () => {
  it('returns exactly n sessions with distinct client-ids and correct tallies', async () => {
    // alternate Control / Variation-1, and one missing header
    let call = 0;
    const fetchImpl = (async () => {
      const idx = call++;
      const variation = idx === 2 ? null : (idx % 2 === 0 ? 'Control' : 'Variation-1');
      return {
        ok: true, status: 200,
        headers: { get: (h: string) => h.toLowerCase() === 'x-vwo-campaigns' && variation ? `[{"CampaignKey":"${KEY}","Variation":"${variation}"}]` : null },
      } as any;
    }) as unknown as typeof fetch;

    const r = await generateVwoSessions(opts, fetchImpl, seqRandom());
    expect(r.n).toBe(5);
    expect(r.sessions).toHaveLength(5);
    expect(r.variation1 + r.control + r.none).toBe(5);
    const ids = new Set(r.sessions.map((s) => s.clientId));
    expect(ids.size).toBe(5); // all distinct
    expect(r.sessions.every((s) => s.clientId.endsWith('.30000603'))).toBe(true);
  });

  it('counts a thrown request as none and still returns n sessions', async () => {
    const fetchImpl = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const r = await generateVwoSessions({ ...opts, n: 3 }, fetchImpl, seqRandom());
    expect(r.sessions).toHaveLength(3);
    expect(r.none).toBe(3);
    expect(r.variation1).toBe(0);
    expect(r.control).toBe(0);
  });

  it('never exceeds the concurrency cap of in-flight requests', async () => {
    let inFlight = 0, maxInFlight = 0;
    const fetchImpl = (async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return { ok: true, status: 200, headers: { get: () => `[{"CampaignKey":"${KEY}","Variation":"Control"}]` } } as any;
    }) as unknown as typeof fetch;
    const r = await generateVwoSessions({ ...opts, n: 10, concurrency: 3 }, fetchImpl, seqRandom());
    expect(r.sessions).toHaveLength(10);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/server`): `npm test -- test/vwo/generateSessions.test.ts`
Expected: FAIL — cannot find module `generateSessions.js`.

- [ ] **Step 3: Write the implementation** — create `apps/server/src/services/vwo/generateSessions.ts`:

```ts
export interface GeneratedSession {
  clientId: string;
  checkoutId: string;
  variation: string | null;
}
export interface GenerateResult {
  n: number;
  variation1: number;
  control: number;
  none: number;
  sessions: GeneratedSession[];
}
export interface GenerateOpts {
  baseUrl: string;
  merchantId: number;
  countryCode: string;
  cultureCode: string;
  campaignKey: string;
  n: number;
  concurrency?: number;
}

/** Parse the `x-vwo-campaigns` header (JSON array) → variation for campaignKey, else null. */
export function extractVariation(
  header: string | null | undefined,
  campaignKey: string,
): string | null {
  if (!header) return null;
  try {
    const arr = JSON.parse(header);
    if (!Array.isArray(arr)) return null;
    const e = arr.find((x) => x && typeof x === 'object' && x.CampaignKey === campaignKey);
    return e && typeof e.Variation === 'string' ? e.Variation : null;
  } catch {
    return null;
  }
}

/**
 * Fire `n` field-validations requests, each with a distinct x-client-id (= one VWO visitor),
 * with a bounded concurrency pool. Always returns exactly `n` sessions; a failed request
 * yields variation:null (counted as `none`). Never throws per-session.
 */
export async function generateVwoSessions(
  opts: GenerateOpts,
  fetchImpl: typeof fetch = fetch,
  randomInt: () => number = () => Math.floor(Math.random() * 1_000_000_000),
): Promise<GenerateResult> {
  const { baseUrl, merchantId, countryCode, cultureCode, campaignKey, n } = opts;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 10, Math.max(1, n)));
  const url =
    `${baseUrl}/api/v1/Shopify/field-validations-and-mapping-rules` +
    `?merchantId=${merchantId}&countryCode=${countryCode}&cultureCode=${cultureCode}`;

  const sessions: GeneratedSession[] = new Array(n);

  async function runOne(i: number): Promise<void> {
    const clientId = `${randomInt()}.${randomInt()}.${merchantId}`;
    const checkoutId = `${randomInt().toString(16)}${randomInt().toString(16)}${randomInt().toString(16)}${randomInt().toString(16)}`
      .padEnd(32, '0')
      .slice(0, 32);
    let variation: string | null = null;
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Origin: 'https://extensions.shopifycdn.com',
          Accept: '*/*',
          'x-client-id': clientId,
          'x-checkout-id': checkoutId,
        },
      });
      if (res.ok) variation = extractVariation(res.headers.get('x-vwo-campaigns'), campaignKey);
    } catch {
      variation = null;
    }
    sessions[i] = { clientId, checkoutId, variation };
  }

  // Bounded pool over indices 0..n-1 — guarantees exactly n results, no dup/drop.
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      await runOne(i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  let variation1 = 0;
  let control = 0;
  let none = 0;
  for (const s of sessions) {
    if (s.variation === 'Variation-1') variation1++;
    else if (s.variation === 'Control') control++;
    else none++;
  }
  return { n, variation1, control, none, sessions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/vwo/generateSessions.test.ts`
Expected: PASS (extractVariation 3 + generate 3).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/vwo/generateSessions.ts apps/server/test/vwo/generateSessions.test.ts
git commit -m "feat(vwo): session generator core (bounded pool, exactly-n, header parse)"
```

---

### Task 2: Dev route + `VWO_GENERATE_ENABLED` flag (apps/server)

**Files:**
- Modify: `apps/server/src/config/environment.ts` (add flag)
- Create: `apps/server/src/api/routes/devTools.ts`
- Modify: `apps/server/src/app.ts` (register)
- Test: `apps/server/test/devTools.test.ts`

**Interfaces:**
- Consumes: `generateVwoSessions` (Task 1), `Environment`.
- Produces: `buildDevToolsRoutes(config, generate?)`; `Environment.VWO_GENERATE_ENABLED: boolean`.

- [ ] **Step 1: Write the failing test** — create `apps/server/test/devTools.test.ts`:

```ts
import Fastify from 'fastify';
import { buildDevToolsRoutes } from '../src/api/routes/devTools.js';
import type { Environment } from '../src/config/environment.js';

function appWith(enabled: boolean, generate: any) {
  const app = Fastify();
  const config = { VWO_GENERATE_ENABLED: enabled } as unknown as Environment;
  app.register(buildDevToolsRoutes(config, generate));
  return app;
}

describe('GET /api/dev/vwo-generate-sessions', () => {
  it('404 when the flag is off (and never calls the generator)', async () => {
    const generate = jest.fn();
    const app = appWith(false, generate);
    const res = await app.inject({ method: 'GET', url: '/api/dev/vwo-generate-sessions?n=10' });
    expect(res.statusCode).toBe(404);
    expect(generate).not.toHaveBeenCalled();
    await app.close();
  });

  it('200 with the generator result when enabled; defaults n to 100', async () => {
    const generate = jest.fn(async (opts: any) => ({ n: opts.n, variation1: 1, control: 1, none: 0, sessions: [] }));
    const app = appWith(true, generate);
    const res = await app.inject({ method: 'GET', url: '/api/dev/vwo-generate-sessions' });
    expect(res.statusCode).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].n).toBe(100);
    expect(JSON.parse(res.body).n).toBe(100);
    await app.close();
  });

  it('clamps n to the [1,500] range', async () => {
    const generate = jest.fn(async (opts: any) => ({ n: opts.n, variation1: 0, control: 0, none: 0, sessions: [] }));
    const app = appWith(true, generate);
    await app.inject({ method: 'GET', url: '/api/dev/vwo-generate-sessions?n=9999' });
    expect(generate.mock.calls[0][0].n).toBe(500);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/devTools.test.ts`
Expected: FAIL — cannot find module `devTools.js`.

- [ ] **Step 3: Add the config flag** — in `apps/server/src/config/environment.ts`, add to the `Environment` type (after `TEAMS_WEBHOOK_URL`):

```ts
  VWO_GENERATE_ENABLED: boolean;
```
and in the returned object of `loadConfig()` (after the `TEAMS_WEBHOOK_URL:` line):

```ts
    VWO_GENERATE_ENABLED: ['true', '1', 'yes'].includes((process.env.VWO_GENERATE_ENABLED ?? '').trim().toLowerCase()),
```

- [ ] **Step 4: Write the route** — create `apps/server/src/api/routes/devTools.ts`:

```ts
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Environment } from '../../config/environment.js';
import { generateVwoSessions } from '../../services/vwo/generateSessions.js';

const CAMPAIGN = 'ShippingAddressValidation';
const BASE_URL = 'https://checkout-service-qa-hf.bglobale.com';

/** Dev-only, flag-gated tool that generates N VWO checkout sessions and returns a summary. */
export function buildDevToolsRoutes(
  config: Environment,
  generate: typeof generateVwoSessions = generateVwoSessions,
): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/api/dev/vwo-generate-sessions',
      { schema: { querystring: Type.Object({ n: Type.Optional(Type.Integer()) }) } },
      async (req, reply) => {
        if (!config.VWO_GENERATE_ENABLED) return reply.code(404).send({ error: 'not found' });
        const n = Math.min(Math.max(req.query.n ?? 100, 1), 500);
        return generate({
          baseUrl: BASE_URL,
          merchantId: 30000603,
          countryCode: 'US',
          cultureCode: 'en-US',
          campaignKey: CAMPAIGN,
          n,
        });
      },
    );
  };
}
```

- [ ] **Step 5: Register in `app.ts`** — add the import with the other route imports:

```ts
import { buildDevToolsRoutes } from './api/routes/devTools.js';
```
and register it alongside the others (e.g. after `buildIntegrationsRoutes`):

```ts
    app.register(buildDevToolsRoutes(config));
```

- [ ] **Step 6: Run tests + type-check**

Run (from `apps/server`): `npm test -- test/devTools.test.ts` → Expected: PASS (3).
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/config/environment.ts apps/server/src/api/routes/devTools.ts apps/server/src/app.ts apps/server/test/devTools.test.ts
git commit -m "feat(vwo): flag-gated /api/dev/vwo-generate-sessions route (VWO_GENERATE_ENABLED)"
```

---

### Task 3: Repurpose the agent (seed script) (apps/server)

**Files:**
- Modify: `apps/server/src/scripts/seed-vwo-agent.ts`
- Modify: `apps/server/test/seedVwoAgent.test.ts`

**Interfaces:**
- Produces: updated `buildVwoAgentInput()` (generator payload) + rename-in-place `main()`.

- [ ] **Step 1: Update the test first** — replace the contents of `apps/server/test/seedVwoAgent.test.ts`:

```ts
import { buildVwoAgentInput, VWO_AGENT_NAME } from '../src/scripts/seed-vwo-agent.js';

describe('buildVwoAgentInput (traffic generator)', () => {
  const a = buildVwoAgentInput();

  it('is the renamed generator agent, haiku, manual-only, Activity-only', () => {
    expect(VWO_AGENT_NAME).toBe('VWO Traffic Generator — ShippingAddressValidation');
    expect(a.name).toBe(VWO_AGENT_NAME);
    expect(a.type).toBe('pr-review');
    expect(a.model).toBe('claude-haiku-4-5');
    expect(a.enabled).toBe(true);
  });

  it('has NO cron (manual-only) and empty outputs', () => {
    const tr = JSON.parse(a.triggerRules);
    expect(tr).toEqual({ events: [] });
    expect(tr.cron).toBeUndefined();
    expect(JSON.parse(a.outputs)).toEqual([]);
    expect(JSON.parse(a.repos)).toEqual([]);
  });

  it('prompt curls the local generator endpoint and reports count + split + ids', () => {
    expect(a.prompt).toContain("curl -sS 'http://localhost:3000/api/dev/vwo-generate-sessions?n=100'");
    expect(a.prompt).toContain('variation1');
    expect(a.prompt).toContain('clientId');
    expect(a.prompt).toContain('checkoutId');
    expect(a.prompt).toContain('Variation-1');
    expect(a.prompt).toContain('Control');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/seedVwoAgent.test.ts`
Expected: FAIL — name is still "VWO Liveness…", prompt/outputs differ.

- [ ] **Step 3: Update the seed script** — in `apps/server/src/scripts/seed-vwo-agent.ts`, replace `VWO_AGENT_NAME`, the `PROMPT`/`ENDPOINT` constants, `buildVwoAgentInput()`, and `main()`'s lookup. Final relevant sections:

```ts
export const VWO_AGENT_NAME = 'VWO Traffic Generator — ShippingAddressValidation';
const OLD_SLUG = 'vwo-liveness-shippingaddressvalidation';
const NEW_SLUG = 'vwo-traffic-generator-shippingaddressvalidation';

const GENERATE_URL = 'http://localhost:3000/api/dev/vwo-generate-sessions?n=100';

const PROMPT = `You are a manual traffic generator for the "ShippingAddressValidation" VWO A/B campaign. When run, you fire 100 checkout sessions via a local helper and report the results.

Run EXACTLY this command:

  curl -sS '${GENERATE_URL}'

It returns JSON of the form:
  { "n": 100, "variation1": <count>, "control": <count>, "none": <count>,
    "sessions": [ { "clientId": "...", "checkoutId": "...", "variation": "Variation-1" | "Control" | null }, ... ] }

Then output a report:
1. A summary line: "<n> calls · <variation1> Variation-1 / <control> Control / <none> none".
2. Then one line per session: "<clientId>  <checkoutId>  <variation>".

Report ONLY the actual data from the JSON — do not invent sessions. If the command fails, returns 404 (the tool is disabled), or returns non-JSON, report that verbatim. Do not run any other commands.`;

export function buildVwoAgentInput(): AgentInsert {
  return {
    name: VWO_AGENT_NAME,
    type: 'pr-review',
    model: 'claude-haiku-4-5',
    prompt: PROMPT,
    repos: '[]',
    triggerRules: JSON.stringify({ events: [] }), // no cron → manual-only
    outputs: JSON.stringify([]),                  // Activity-only, no Teams
    enabled: true,
    title: 'VWO traffic generator (manual)',
    bio: 'Manual run: fires 100 distinct-client-id sessions at the ShippingAddressValidation endpoint and reports the Control/Variation-1 split + generated ids.',
  };
}

function main(): void {
  try {
    loadEnv({ path: resolve(__dirname, '../../../../.env') });
    getDb(process.env.DATABASE_URL ?? './agent-hub.db');
    const input = buildVwoAgentInput();
    // Rename in place: match the new slug, else the old liveness slug. Never leave a duplicate.
    const existing =
      AgentRepository.findBySlug(NEW_SLUG) ?? AgentRepository.findBySlug(OLD_SLUG);
    if (existing) {
      AgentRepository.update(existing.id, input);
      console.log(`[seed-vwo-agent] updated agent ${existing.id} -> ${VWO_AGENT_NAME}`);
    } else {
      const row = AgentRepository.create(input);
      console.log(`[seed-vwo-agent] created agent ${row.id}`);
    }
  } catch (err) {
    console.error('[seed-vwo-agent] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
```
Keep the existing top imports (`loadEnv`, `resolve`, `AgentRepository`, `slugify` [now unused — remove the `slugify` import if it is no longer referenced], `getDb`) and the trailing `if (require.main === module) { main(); }` guard. Remove the now-unused `slugify` import to keep tsc/lint clean.

- [ ] **Step 4: Run test + type-check**

Run: `npm test -- test/seedVwoAgent.test.ts` → Expected: PASS (3).
Run: `npx tsc --noEmit` → Expected: no errors (confirm no unused-import error for `slugify`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/scripts/seed-vwo-agent.ts apps/server/test/seedVwoAgent.test.ts
git commit -m "feat(vwo): repurpose agent as manual traffic generator (rename-in-place, no cron)"
```

---

## Manual verification / activation (needs a server restart — new route)

1. `npx tsc` in `apps/server`.
2. In root `.env`: add `VWO_GENERATE_ENABLED=true` (AGENT_CURL_ENABLED already on).
3. **Restart the server** (:3000) from fresh dist — the new route only exists after restart.
4. Re-run the seed: `node dist/scripts/seed-vwo-agent.js` → renames the existing record to **VWO Traffic Generator — ShippingAddressValidation** (manual, no cron). Refresh the Agents screen.
5. Hit **RUN**. Activity should show: `session started` → `🔧 Bash — curl …/vwo-generate-sessions?n=100` → a report with the `<n> calls · X Variation-1 / Y Control / Z none` line + 100 `clientId checkoutId variation` lines.
6. Optional smoke without the agent: `curl -sS 'http://localhost:3000/api/dev/vwo-generate-sessions?n=5'` → JSON with 5 sessions.

## Global self-review checklist (done during authoring)

- Spec coverage: generator core + exactly-n + header parse (Task 1); flag + gated 404 route + clamp + register (Task 2); rename-in-place manual agent + prompt reporting count/split/ids (Task 3); concurrency-cap test (Task 1); activation-needs-restart (verification) — all covered.
- Type consistency: `generateVwoSessions(opts, fetchImpl?, randomInt?)` signature matches route's `generate` DI default and the test stubs; `GenerateResult` fields (n/variation1/control/none/sessions) match the prompt's documented JSON and the route return; `Environment.VWO_GENERATE_ENABLED` used by the route.
- No placeholders: complete code + exact commands in every step.
```
