# VWO A/B Liveness Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native (non-LLM) server service to agent-hub that probes the CheckoutService field-validations endpoint on a daily cron and alerts the Agent-hub Teams channel when the `ShippingAddressValidation` VWO campaign stops being served.

**Architecture:** A self-contained service under `apps/server/src/services/monitoring/` composed of four small units — a config loader, an HTTP probe, a pure state machine, and an orchestrator that owns its own `croner` `Cron`. It reuses the existing `TeamsWebhookNotifier` for output. It runs inside the `apps/server` process, started from `index.ts` next to `startScheduler()`. No Claude runner, no tool-policy change, no DB table/migration.

**Tech Stack:** TypeScript, Node ≥18 (global `fetch`/`AbortController`), `croner` ^9 (already a dep), Jest + ts-jest (existing setup), Fastify `app.log` (pino).

## Global Constraints

- Endpoint (GET): `{baseUrl}/api/v1/Shopify/field-validations-and-mapping-rules?merchantId={id}&countryCode={cc}&cultureCode={culture}`, sent with header `Origin: https://extensions.shopifycdn.com`.
- Liveness signal: response HTTP 200 **and** the `x-vwo-campaigns` header parses to a JSON array containing an entry whose `CampaignKey` equals the configured campaign key. The entry's `Variation` (`Control` / `Variation-1` / …) is recorded but ANY variation counts as live.
- Default campaign key: `ShippingAddressValidation`. Default cron: `0 9 * * *`. Default base URL: `https://checkout-service-qa-hf.bglobale.com`. Default merchants: `30000603:US:en-US`.
- Env vars: `VWO_MONITOR_ENABLED` (default false / opt-in), `VWO_MONITOR_BASE_URL`, `VWO_MONITOR_CAMPAIGN_KEY`, `VWO_MONITOR_CRON`, `VWO_MONITOR_MERCHANTS` (comma list of `merchantId:countryCode:cultureCode`). Reuses existing `TEAMS_WEBHOOK_URL`.
- `Action` is the bare string union `'none' | 'failure' | 'recovery' | 'heartbeat'` — one canonical representation everywhere.
- Teams POST uses `Content-Type: application/json; charset=utf-8` (existing notifier already does this). `postCard` throws on non-2xx; callers wrap in `.catch`.
- `isDailyTick` is passed `true` by the orchestrator (daily cron); the `'none'` branch is future-proofing only.
- TDD: every task writes a failing test first. Run single test files with `npm test -- <path>` from `apps/server`. Import source with the `.js` extension (ts-jest resolves to `.ts`), matching existing tests.

---

### Task 1: Monitor config loader

**Files:**
- Create: `apps/server/src/services/monitoring/vwoMonitorConfig.ts`
- Test: `apps/server/test/vwoMonitor/vwoMonitorConfig.test.ts`

**Interfaces:**
- Consumes: `process.env` (injectable for tests).
- Produces:
  - `interface Merchant { merchantId: number; countryCode: string; cultureCode: string; }`
  - `interface VwoMonitorConfig { enabled: boolean; baseUrl: string; campaignKey: string; cron: string; merchants: Merchant[]; teamsWebhookUrl: string | undefined; }`
  - `function loadVwoMonitorConfig(env?: NodeJS.ProcessEnv): VwoMonitorConfig`
  - `function parseMerchants(raw: string): Merchant[]`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/vwoMonitor/vwoMonitorConfig.test.ts`:

```ts
import { loadVwoMonitorConfig, parseMerchants } from '../../src/services/monitoring/vwoMonitorConfig.js';

describe('parseMerchants', () => {
  it('parses a single merchantId:country:culture tuple', () => {
    expect(parseMerchants('30000603:US:en-US')).toEqual([
      { merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US' },
    ]);
  });
  it('parses a comma list and trims whitespace', () => {
    expect(parseMerchants(' 1:US:en-US , 2:GB:en-GB ')).toEqual([
      { merchantId: 1, countryCode: 'US', cultureCode: 'en-US' },
      { merchantId: 2, countryCode: 'GB', cultureCode: 'en-GB' },
    ]);
  });
  it('drops malformed entries (bad id / missing parts)', () => {
    expect(parseMerchants('abc:US:en-US,,5:US')).toEqual([]);
  });
});

describe('loadVwoMonitorConfig', () => {
  it('applies defaults with an empty env (disabled, QA-HF merchant)', () => {
    const cfg = loadVwoMonitorConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(false);
    expect(cfg.baseUrl).toBe('https://checkout-service-qa-hf.bglobale.com');
    expect(cfg.campaignKey).toBe('ShippingAddressValidation');
    expect(cfg.cron).toBe('0 9 * * *');
    expect(cfg.merchants).toEqual([{ merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US' }]);
    expect(cfg.teamsWebhookUrl).toBeUndefined();
  });
  it('reads overrides and strips a trailing slash from baseUrl', () => {
    const cfg = loadVwoMonitorConfig({
      VWO_MONITOR_ENABLED: 'true',
      VWO_MONITOR_BASE_URL: 'https://example.com/',
      VWO_MONITOR_CAMPAIGN_KEY: 'OtherCampaign',
      VWO_MONITOR_CRON: '*/15 * * * *',
      VWO_MONITOR_MERCHANTS: '111:US:en-US',
      TEAMS_WEBHOOK_URL: 'https://hook',
    } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.baseUrl).toBe('https://example.com');
    expect(cfg.campaignKey).toBe('OtherCampaign');
    expect(cfg.cron).toBe('*/15 * * * *');
    expect(cfg.merchants).toEqual([{ merchantId: 111, countryCode: 'US', cultureCode: 'en-US' }]);
    expect(cfg.teamsWebhookUrl).toBe('https://hook');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/vwoMonitor/vwoMonitorConfig.test.ts` (from `apps/server`)
Expected: FAIL — cannot find module `vwoMonitorConfig.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/services/monitoring/vwoMonitorConfig.ts`:

```ts
export interface Merchant {
  merchantId: number;
  countryCode: string;
  cultureCode: string;
}

export interface VwoMonitorConfig {
  enabled: boolean;
  baseUrl: string;
  campaignKey: string;
  cron: string;
  merchants: Merchant[];
  teamsWebhookUrl: string | undefined;
}

const DEFAULT_MERCHANTS = '30000603:US:en-US';

/** Parse a comma list of `merchantId:countryCode:cultureCode`; malformed entries are dropped. */
export function parseMerchants(raw: string): Merchant[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok): Merchant | null => {
      const [id, country, culture] = tok.split(':').map((p) => (p ?? '').trim());
      const merchantId = Number(id);
      if (!Number.isFinite(merchantId) || merchantId <= 0 || !country || !culture) return null;
      return { merchantId, countryCode: country, cultureCode: culture };
    })
    .filter((m): m is Merchant => m !== null);
}

export function loadVwoMonitorConfig(env: NodeJS.ProcessEnv = process.env): VwoMonitorConfig {
  const enabled = ['true', '1', 'yes'].includes((env.VWO_MONITOR_ENABLED ?? '').trim().toLowerCase());
  return {
    enabled,
    baseUrl: (env.VWO_MONITOR_BASE_URL ?? 'https://checkout-service-qa-hf.bglobale.com').replace(/\/+$/, ''),
    campaignKey: env.VWO_MONITOR_CAMPAIGN_KEY ?? 'ShippingAddressValidation',
    cron: env.VWO_MONITOR_CRON ?? '0 9 * * *',
    merchants: parseMerchants(env.VWO_MONITOR_MERCHANTS ?? DEFAULT_MERCHANTS),
    teamsWebhookUrl: env.TEAMS_WEBHOOK_URL,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/vwoMonitor/vwoMonitorConfig.test.ts`
Expected: PASS (3 + 2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/monitoring/vwoMonitorConfig.ts apps/server/test/vwoMonitor/vwoMonitorConfig.test.ts
git commit -m "feat(vwo-monitor): config loader + merchant list parsing"
```

---

### Task 2: HTTP probe (`extractVariation` + `probeMerchant`)

**Files:**
- Create: `apps/server/src/services/monitoring/probe.ts`
- Test: `apps/server/test/vwoMonitor/probe.test.ts`

**Interfaces:**
- Consumes: `Merchant` from `vwoMonitorConfig.js`; global `fetch`, `AbortController`.
- Produces:
  - `type ProbeResult = { ok: true; merchantId: number; httpStatus: number; variation: string } | { ok: false; merchantId: number; reason: 'non_200' | 'timeout' | 'network' | 'campaign_missing'; httpStatus?: number; detail?: string }`
  - `function extractVariation(headerValue: string | null | undefined, campaignKey: string): string | null`
  - `function probeMerchant(cfg: { baseUrl: string; campaignKey: string }, merchant: Merchant, timeoutMs?: number): Promise<ProbeResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/vwoMonitor/probe.test.ts`:

```ts
import { extractVariation, probeMerchant } from '../../src/services/monitoring/probe.js';

const KEY = 'ShippingAddressValidation';
const merchant = { merchantId: 30000603, countryCode: 'US', cultureCode: 'en-US' };
const cfg = { baseUrl: 'https://cs.example.com', campaignKey: KEY };

describe('extractVariation', () => {
  it('returns the variation for a matching single-entry header', () => {
    expect(extractVariation(`[{"CampaignKey":"${KEY}","Variation":"Variation-1"}]`, KEY)).toBe('Variation-1');
  });
  it('returns Control when that is the assigned variation', () => {
    expect(extractVariation(`[{"CampaignKey":"${KEY}","Variation":"Control"}]`, KEY)).toBe('Control');
  });
  it('finds the target campaign among multiple entries', () => {
    const hdr = `[{"CampaignKey":"Other","Variation":"A"},{"CampaignKey":"${KEY}","Variation":"Control"}]`;
    expect(extractVariation(hdr, KEY)).toBe('Control');
  });
  it('returns null for a missing header', () => {
    expect(extractVariation(null, KEY)).toBeNull();
    expect(extractVariation(undefined, KEY)).toBeNull();
  });
  it('returns null for malformed JSON', () => {
    expect(extractVariation('not json', KEY)).toBeNull();
  });
  it('returns null when the campaign key is absent', () => {
    expect(extractVariation('[{"CampaignKey":"Other","Variation":"A"}]', KEY)).toBeNull();
  });
});

function mockFetch(impl: (url: string) => any) {
  global.fetch = jest.fn(async (url: any) => impl(String(url))) as any;
}

describe('probeMerchant', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('returns ok with the variation on 200 + valid header', async () => {
    mockFetch(() => ({
      ok: true, status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'x-vwo-campaigns'
        ? `[{"CampaignKey":"${KEY}","Variation":"Variation-1"}]` : null) },
    }));
    const r = await probeMerchant(cfg, merchant);
    expect(r).toEqual({ ok: true, merchantId: 30000603, httpStatus: 200, variation: 'Variation-1' });
  });

  it('returns campaign_missing on 200 with no matching header', async () => {
    mockFetch(() => ({ ok: true, status: 200, headers: { get: () => null } }));
    const r = await probeMerchant(cfg, merchant);
    expect(r).toMatchObject({ ok: false, reason: 'campaign_missing', httpStatus: 200 });
  });

  it('returns non_200 on a 500', async () => {
    mockFetch(() => ({ ok: false, status: 500, headers: { get: () => null } }));
    const r = await probeMerchant(cfg, merchant);
    expect(r).toMatchObject({ ok: false, reason: 'non_200', httpStatus: 500 });
  });

  it('returns network on a thrown fetch', async () => {
    global.fetch = jest.fn(async () => { throw new Error('boom'); }) as any;
    const r = await probeMerchant(cfg, merchant);
    expect(r).toMatchObject({ ok: false, reason: 'network' });
  });

  it('returns timeout when the request aborts', async () => {
    global.fetch = jest.fn(async () => {
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    }) as any;
    const r = await probeMerchant(cfg, merchant, 5);
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('builds the correct URL and Origin header', async () => {
    let seenUrl = ''; let seenInit: any;
    global.fetch = jest.fn(async (url: any, init: any) => {
      seenUrl = String(url); seenInit = init;
      return { ok: true, status: 200, headers: { get: () => `[{"CampaignKey":"${KEY}","Variation":"Control"}]` } };
    }) as any;
    await probeMerchant(cfg, merchant);
    expect(seenUrl).toBe('https://cs.example.com/api/v1/Shopify/field-validations-and-mapping-rules?merchantId=30000603&countryCode=US&cultureCode=en-US');
    expect(seenInit.headers.Origin).toBe('https://extensions.shopifycdn.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/vwoMonitor/probe.test.ts`
Expected: FAIL — cannot find module `probe.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/services/monitoring/probe.ts`:

```ts
import type { Merchant } from './vwoMonitorConfig.js';

export type ProbeResult =
  | { ok: true; merchantId: number; httpStatus: number; variation: string }
  | {
      ok: false;
      merchantId: number;
      reason: 'non_200' | 'timeout' | 'network' | 'campaign_missing';
      httpStatus?: number;
      detail?: string;
    };

/** Parse the `x-vwo-campaigns` header and return the variation for `campaignKey`, or null. */
export function extractVariation(
  headerValue: string | null | undefined,
  campaignKey: string,
): string | null {
  if (!headerValue) return null;
  try {
    const arr = JSON.parse(headerValue);
    if (!Array.isArray(arr)) return null;
    const entry = arr.find(
      (e) => e && typeof e === 'object' && e.CampaignKey === campaignKey,
    );
    return entry && typeof entry.Variation === 'string' ? entry.Variation : null;
  } catch {
    return null;
  }
}

/** Single probe of one merchant. Never throws — all faults map to a ProbeResult. */
export async function probeMerchant(
  cfg: { baseUrl: string; campaignKey: string },
  merchant: Merchant,
  timeoutMs = 10_000,
): Promise<ProbeResult> {
  const url =
    `${cfg.baseUrl}/api/v1/Shopify/field-validations-and-mapping-rules` +
    `?merchantId=${merchant.merchantId}&countryCode=${merchant.countryCode}&cultureCode=${merchant.cultureCode}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Origin: 'https://extensions.shopifycdn.com', Accept: '*/*' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, merchantId: merchant.merchantId, reason: 'non_200', httpStatus: res.status };
    }
    const variation = extractVariation(res.headers.get('x-vwo-campaigns'), cfg.campaignKey);
    if (variation === null) {
      return { ok: false, merchantId: merchant.merchantId, reason: 'campaign_missing', httpStatus: res.status };
    }
    return { ok: true, merchantId: merchant.merchantId, httpStatus: res.status, variation };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, merchantId: merchant.merchantId, reason, detail: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/vwoMonitor/probe.test.ts`
Expected: PASS (6 extractVariation + 6 probeMerchant).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/monitoring/probe.ts apps/server/test/vwoMonitor/probe.test.ts
git commit -m "feat(vwo-monitor): HTTP probe + x-vwo-campaigns header parsing"
```

---

### Task 3: State machine (`decide`)

**Files:**
- Create: `apps/server/src/services/monitoring/stateMachine.ts`
- Test: `apps/server/test/vwoMonitor/stateMachine.test.ts`

**Interfaces:**
- Consumes: `ProbeResult` from `probe.js`.
- Produces:
  - `type State = 'unknown' | 'healthy' | 'failing'`
  - `type Action = 'none' | 'failure' | 'recovery' | 'heartbeat'`
  - `function decide(prev: State, result: ProbeResult, isDailyTick: boolean): { next: State; action: Action }`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/vwoMonitor/stateMachine.test.ts`:

```ts
import { decide, State } from '../../src/services/monitoring/stateMachine.js';
import type { ProbeResult } from '../../src/services/monitoring/probe.js';

const ok: ProbeResult = { ok: true, merchantId: 1, httpStatus: 200, variation: 'Control' };
const fail: ProbeResult = { ok: false, merchantId: 1, reason: 'campaign_missing', httpStatus: 200 };

describe('decide', () => {
  it('unknown + healthy on a daily tick → heartbeat', () => {
    expect(decide('unknown', ok, true)).toEqual({ next: 'healthy', action: 'heartbeat' });
  });
  it('any state + failure → failing/failure', () => {
    expect(decide('healthy', fail, true)).toEqual({ next: 'failing', action: 'failure' });
    expect(decide('unknown', fail, true)).toEqual({ next: 'failing', action: 'failure' });
  });
  it('failing + healthy → recovery (takes precedence over heartbeat)', () => {
    expect(decide('failing', ok, true)).toEqual({ next: 'healthy', action: 'recovery' });
  });
  it('healthy + healthy on a NON-daily tick → none', () => {
    expect(decide('healthy', ok, false)).toEqual({ next: 'healthy', action: 'none' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/vwoMonitor/stateMachine.test.ts`
Expected: FAIL — cannot find module `stateMachine.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/services/monitoring/stateMachine.ts`:

```ts
import type { ProbeResult } from './probe.js';

export type State = 'unknown' | 'healthy' | 'failing';
export type Action = 'none' | 'failure' | 'recovery' | 'heartbeat';

/**
 * Decide the next state and whether/what to post.
 * Rules (order matters — failure and recovery beat heartbeat):
 *  - probe failed                    → failing / 'failure'
 *  - probe ok and previously failing → healthy / 'recovery'
 *  - probe ok and daily tick         → healthy / 'heartbeat'
 *  - otherwise                       → healthy / 'none'  (higher-cadence future use)
 */
export function decide(
  prev: State,
  result: ProbeResult,
  isDailyTick: boolean,
): { next: State; action: Action } {
  if (!result.ok) return { next: 'failing', action: 'failure' };
  if (prev === 'failing') return { next: 'healthy', action: 'recovery' };
  if (isDailyTick) return { next: 'healthy', action: 'heartbeat' };
  return { next: 'healthy', action: 'none' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/vwoMonitor/stateMachine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/monitoring/stateMachine.ts apps/server/test/vwoMonitor/stateMachine.test.ts
git commit -m "feat(vwo-monitor): failure/recovery/heartbeat state machine"
```

---

### Task 4: Teams card — `buildVwoCard` + `postCard` (refactor notifier)

**Files:**
- Modify: `apps/server/src/services/teams/TeamsWebhookNotifier.ts` (extract a shared `buildCard`, add `buildVwoCard`, add `postCard`, make `postResult` delegate)
- Test: `apps/server/test/teams/teamsWebhookNotifier.test.ts` (extend — existing tests MUST still pass)

**Interfaces:**
- Consumes: global `fetch`.
- Produces (new exports):
  - `function buildVwoCard(action: 'failure' | 'recovery' | 'heartbeat', lines: string[]): object`
  - `TeamsWebhookNotifier.postCard(card: object): Promise<void>`
- Preserves: `buildAgentCard(agentName, status, body)` and `postResult(agentName, status, body)` behavior (existing tests unchanged).

- [ ] **Step 1: Write the failing test (append to the existing file)**

Append to `apps/server/test/teams/teamsWebhookNotifier.test.ts`:

```ts
import { buildVwoCard } from '../../src/services/teams/TeamsWebhookNotifier.js';

describe('buildVwoCard', () => {
  it('failure card uses ❌ and a DOWN title', () => {
    const card = buildVwoCard('failure', ['merchant 1: FAILED reason=campaign_missing']) as any;
    const title = card.attachments[0].content.body[0].text;
    expect(title).toContain('❌');
    expect(title).toContain('DOWN');
    expect(card.attachments[0].content.body[1].text).toContain('campaign_missing');
  });
  it('recovery card uses ✅ and a RECOVERED title', () => {
    const title = (buildVwoCard('recovery', ['ok']) as any).attachments[0].content.body[0].text;
    expect(title).toContain('✅');
    expect(title).toContain('RECOVERED');
  });
  it('heartbeat card uses ✅ and a healthy title', () => {
    const title = (buildVwoCard('heartbeat', ['ok']) as any).attachments[0].content.body[0].text;
    expect(title).toContain('✅');
    expect(title).toMatch(/healthy/i);
  });
  it('joins multiple lines into the body', () => {
    const body = (buildVwoCard('heartbeat', ['line-a', 'line-b']) as any).attachments[0].content.body[1].text;
    expect(body).toContain('line-a');
    expect(body).toContain('line-b');
  });
});

describe('TeamsWebhookNotifier.postCard', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('posts the given card to the URL with the correct Content-Type', async () => {
    let capturedUrl = ''; let capturedInit: any;
    global.fetch = jest.fn(async (url: any, init: any) => { capturedUrl = String(url); capturedInit = init; return { ok: true, status: 202 } as Response; }) as any;
    const { TeamsWebhookNotifier } = await import('../../src/services/teams/TeamsWebhookNotifier.js');
    const notifier = new TeamsWebhookNotifier('https://hook');
    await notifier.postCard(buildVwoCard('heartbeat', ['ok']));
    expect(capturedUrl).toBe('https://hook');
    expect((capturedInit.headers as Record<string, string>)['Content-Type']).toBe('application/json; charset=utf-8');
  });

  it('throws with the status code on a non-ok response', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 429 } as Response)) as any;
    const { TeamsWebhookNotifier } = await import('../../src/services/teams/TeamsWebhookNotifier.js');
    await expect(new TeamsWebhookNotifier('https://hook').postCard({})).rejects.toThrow('429');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/teams/teamsWebhookNotifier.test.ts`
Expected: FAIL — `buildVwoCard` / `postCard` are not exported.

- [ ] **Step 3: Write minimal implementation**

Replace the contents of `apps/server/src/services/teams/TeamsWebhookNotifier.ts` with:

```ts
const MAX_BODY_LEN = 18_000;

/** Shared Adaptive-Card envelope builder: a bold title block + a wrapping body block. */
function buildCard(titleText: string, body: string): object {
  let bodyText = body;
  if (bodyText.length > MAX_BODY_LEN) {
    bodyText = bodyText.slice(0, MAX_BODY_LEN) + '\n\n…(truncated)';
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body: [
            { type: 'TextBlock', weight: 'Bolder', size: 'Medium', text: titleText },
            { type: 'TextBlock', wrap: true, text: bodyText },
          ],
        },
      },
    ],
  };
}

export function buildAgentCard(
  agentName: string,
  status: 'done' | 'failed',
  body: string,
): object {
  const isDone = status === 'done';
  return buildCard(`${isDone ? '✅' : '❌'} ${agentName} — ${isDone ? 'completed' : 'failed'}`, body);
}

const VWO_CARD_META: Record<'failure' | 'recovery' | 'heartbeat', { icon: string; title: string }> = {
  failure: { icon: '❌', title: 'VWO Liveness — DOWN' },
  recovery: { icon: '✅', title: 'VWO Liveness — RECOVERED' },
  heartbeat: { icon: '✅', title: 'VWO Liveness — healthy' },
};

export function buildVwoCard(
  action: 'failure' | 'recovery' | 'heartbeat',
  lines: string[],
): object {
  const meta = VWO_CARD_META[action];
  return buildCard(`${meta.icon} ${meta.title}`, lines.join('\n'));
}

export class TeamsWebhookNotifier {
  constructor(private url: string) {}

  /** Post a pre-built Adaptive Card. Throws on a non-2xx response. */
  async postCard(card: object): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      throw new Error(`TeamsWebhookNotifier: POST failed with status ${res.status}`);
    }
  }

  async postResult(
    agentName: string,
    status: 'done' | 'failed',
    body: string,
  ): Promise<void> {
    await this.postCard(buildAgentCard(agentName, status, body));
  }
}
```

- [ ] **Step 4: Run test to verify it passes (new + existing)**

Run: `npm test -- test/teams/teamsWebhookNotifier.test.ts`
Expected: PASS — the original `buildAgentCard`/`postResult` tests AND the new `buildVwoCard`/`postCard` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/teams/TeamsWebhookNotifier.ts apps/server/test/teams/teamsWebhookNotifier.test.ts
git commit -m "feat(vwo-monitor): buildVwoCard + generic postCard on TeamsWebhookNotifier"
```

---

### Task 5: Orchestrator (`createVwoMonitor` + `startVwoMonitor`)

**Files:**
- Create: `apps/server/src/services/monitoring/VwoAbMonitor.ts`
- Test: `apps/server/test/vwoMonitor/vwoAbMonitor.test.ts`

**Interfaces:**
- Consumes: `VwoMonitorConfig`, `Merchant` (`vwoMonitorConfig.js`); `ProbeResult`, `probeMerchant` (`probe.js`); `decide`, `State` (`stateMachine.js`); `TeamsWebhookNotifier`, `buildVwoCard` (`../teams/TeamsWebhookNotifier.js`); `Cron` (`croner`).
- Produces:
  - `interface VwoMonitorDeps { config: VwoMonitorConfig; probe: (m: Merchant) => Promise<ProbeResult>; postCard: (card: object) => Promise<void>; log: MonitorLog; retryDelayMs?: number; sleep?: (ms: number) => Promise<void>; }`
  - `interface MonitorLog { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void; }`
  - `function createVwoMonitor(deps: VwoMonitorDeps): { tick: () => Promise<void>; start: () => () => void }`
  - `function startVwoMonitor(env: NodeJS.ProcessEnv, log: MonitorLog): () => void`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/vwoMonitor/vwoAbMonitor.test.ts`:

```ts
import { createVwoMonitor } from '../../src/services/monitoring/VwoAbMonitor.js';
import type { VwoMonitorConfig } from '../../src/services/monitoring/vwoMonitorConfig.js';
import type { ProbeResult } from '../../src/services/monitoring/probe.js';

const merchant = { merchantId: 1, countryCode: 'US', cultureCode: 'en-US' };
const baseConfig: VwoMonitorConfig = {
  enabled: true, baseUrl: 'https://cs', campaignKey: 'ShippingAddressValidation',
  cron: '0 9 * * *', merchants: [merchant], teamsWebhookUrl: 'https://hook',
};
const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
const ok: ProbeResult = { ok: true, merchantId: 1, httpStatus: 200, variation: 'Control' };
const missing: ProbeResult = { ok: false, merchantId: 1, reason: 'campaign_missing', httpStatus: 200 };
const netFail: ProbeResult = { ok: false, merchantId: 1, reason: 'network', detail: 'x' };

// The card is the only observable output; assert on its title block.
function titleOf(card: any): string { return card.attachments[0].content.body[0].text; }

describe('createVwoMonitor.tick', () => {
  it('posts a heartbeat when healthy from unknown', async () => {
    const posted: any[] = [];
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => ok,
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(posted).toHaveLength(1);
    expect(titleOf(posted[0])).toMatch(/healthy/i);
  });

  it('posts a failure card when the probe fails', async () => {
    const posted: any[] = [];
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => missing,
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(titleOf(posted[0])).toContain('DOWN');
  });

  it('posts a recovery card on failing → healthy across two ticks', async () => {
    const posted: any[] = [];
    const seq = [missing, ok]; let i = 0;
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => seq[i++],
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick(); // failing
    await monitor.tick(); // recovery
    expect(titleOf(posted[0])).toContain('DOWN');
    expect(titleOf(posted[1])).toContain('RECOVERED');
  });

  it('retries once on a transient (non-campaign_missing) failure and does NOT post if the retry succeeds', async () => {
    const posted: any[] = [];
    const seq = [netFail, ok]; let calls = 0;
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => seq[calls++],
      postCard: async (c) => { posted.push(c); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(calls).toBe(2);                 // retried
    expect(titleOf(posted[0])).toMatch(/healthy/i); // heartbeat, not failure
  });

  it('does NOT retry on campaign_missing (that is the signal, not a blip)', async () => {
    let calls = 0;
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => { calls++; return missing; },
      postCard: async () => {}, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await monitor.tick();
    expect(calls).toBe(1);
  });

  it('swallows a Teams post error (never throws out of tick)', async () => {
    const monitor = createVwoMonitor({
      config: baseConfig, probe: async () => ok,
      postCard: async () => { throw new Error('teams down'); }, log: noopLog, retryDelayMs: 0, sleep: async () => {},
    });
    await expect(monitor.tick()).resolves.toBeUndefined();
  });
});

describe('createVwoMonitor.start', () => {
  it('does not schedule when disabled and returns a no-op stop', () => {
    const monitor = createVwoMonitor({
      config: { ...baseConfig, enabled: false }, probe: async () => ok,
      postCard: async () => {}, log: noopLog,
    });
    const stop = monitor.start();
    expect(typeof stop).toBe('function');
    stop(); // must not throw
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/vwoMonitor/vwoAbMonitor.test.ts`
Expected: FAIL — cannot find module `VwoAbMonitor.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/services/monitoring/VwoAbMonitor.ts`:

```ts
import { Cron } from 'croner';
import { loadVwoMonitorConfig, type VwoMonitorConfig, type Merchant } from './vwoMonitorConfig.js';
import { probeMerchant, type ProbeResult } from './probe.js';
import { decide, type State } from './stateMachine.js';
import { TeamsWebhookNotifier, buildVwoCard } from '../teams/TeamsWebhookNotifier.js';

export interface MonitorLog {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
  error: (o: object, m?: string) => void;
}

export interface VwoMonitorDeps {
  config: VwoMonitorConfig;
  probe: (m: Merchant) => Promise<ProbeResult>;
  postCard: (card: object) => Promise<void>;
  log: MonitorLog;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function describeResult(m: Merchant, r: ProbeResult): string {
  const who = `merchant ${m.merchantId} (${m.countryCode}/${m.cultureCode})`;
  return r.ok
    ? `${who}: variation=${r.variation}, HTTP ${r.httpStatus}`
    : `${who}: FAILED reason=${r.reason}${r.httpStatus ? `, HTTP ${r.httpStatus}` : ''}`;
}

export function createVwoMonitor(deps: VwoMonitorDeps): {
  tick: () => Promise<void>;
  start: () => () => void;
} {
  const state = new Map<number, State>();
  const retryDelayMs = deps.retryDelayMs ?? 3_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // One probe; retry ONCE on a transient failure. campaign_missing is the signal
  // we alert on (not a blip), so it is never retried.
  async function probeWithRetry(m: Merchant): Promise<ProbeResult> {
    const first = await deps.probe(m);
    if (first.ok || first.reason === 'campaign_missing') return first;
    await sleep(retryDelayMs);
    return deps.probe(m);
  }

  async function tick(): Promise<void> {
    for (const m of deps.config.merchants) {
      try {
        const result = await probeWithRetry(m);
        const prev = state.get(m.merchantId) ?? 'unknown';
        const { next, action } = decide(prev, result, /* isDailyTick */ true);
        state.set(m.merchantId, next);

        const line = describeResult(m, result);
        deps.log.info({ merchantId: m.merchantId, action, result }, `[VwoMonitor] ${line}`);

        if (action !== 'none') {
          await deps
            .postCard(buildVwoCard(action, [line]))
            .catch((e) => deps.log.error({ err: String(e), merchantId: m.merchantId }, '[VwoMonitor] Teams post failed'));
        }
      } catch (e) {
        deps.log.error({ err: String(e), merchantId: m.merchantId }, '[VwoMonitor] tick failed for merchant');
      }
    }
  }

  function start(): () => void {
    if (!deps.config.enabled) {
      deps.log.info({}, '[VwoMonitor] disabled (VWO_MONITOR_ENABLED not set) — not scheduling');
      return () => {};
    }
    const cron = new Cron(deps.config.cron, () => { void tick(); });
    deps.log.info(
      { cron: deps.config.cron, merchants: deps.config.merchants.length },
      '[VwoMonitor] scheduled',
    );
    return () => cron.stop();
  }

  return { tick, start };
}

/** Wire real dependencies from env and start the monitor. Returns a stop function. */
export function startVwoMonitor(env: NodeJS.ProcessEnv, log: MonitorLog): () => void {
  const config = loadVwoMonitorConfig(env);
  if (config.enabled && !config.teamsWebhookUrl) {
    log.warn({}, '[VwoMonitor] enabled but TEAMS_WEBHOOK_URL is not set — alerts cannot be delivered');
  }
  const notifier = config.teamsWebhookUrl ? new TeamsWebhookNotifier(config.teamsWebhookUrl) : null;
  const monitor = createVwoMonitor({
    config,
    probe: (m) => probeMerchant(config, m),
    postCard: (card) =>
      notifier ? notifier.postCard(card) : Promise.reject(new Error('TEAMS_WEBHOOK_URL not set')),
    log,
  });
  return monitor.start();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/vwoMonitor/vwoAbMonitor.test.ts`
Expected: PASS (6 tick tests + 1 start test).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/monitoring/VwoAbMonitor.ts apps/server/test/vwoMonitor/vwoAbMonitor.test.ts
git commit -m "feat(vwo-monitor): orchestrator with retry, state, and cron scheduling"
```

---

### Task 6: Wire into server startup + env docs

**Files:**
- Modify: `apps/server/src/index.ts` (call `startVwoMonitor` after `listen`)
- Modify: `.env.example` at repo root if present (else create it) — document the new vars
- Test: `apps/server/test/vwoMonitor/startup.test.ts` (smoke: `startVwoMonitor` with a disabled env returns a callable stop and posts nothing)

**Interfaces:**
- Consumes: `startVwoMonitor(env, log)` from `./services/monitoring/VwoAbMonitor.js`; `app.log` (pino, satisfies `MonitorLog`).

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/vwoMonitor/startup.test.ts`:

```ts
import { startVwoMonitor } from '../../src/services/monitoring/VwoAbMonitor.js';

describe('startVwoMonitor wiring', () => {
  const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

  it('returns a no-op stop when disabled and never touches fetch', () => {
    const originalFetch = global.fetch;
    const spy = jest.fn();
    global.fetch = spy as any;
    try {
      const stop = startVwoMonitor({} as NodeJS.ProcessEnv, noopLog); // VWO_MONITOR_ENABLED unset → disabled
      expect(typeof stop).toBe('function');
      stop();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('warns when enabled without a Teams webhook URL', () => {
    let warned = false;
    const log = { info: () => {}, warn: () => { warned = true; }, error: () => {} };
    const stop = startVwoMonitor(
      { VWO_MONITOR_ENABLED: 'true' } as NodeJS.ProcessEnv, // enabled, no TEAMS_WEBHOOK_URL
      log,
    );
    expect(warned).toBe(true);
    stop(); // stop the cron so the test process can exit cleanly
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/vwoMonitor/startup.test.ts`
Expected: PASS for the disabled case is possible already (Task 5 exists), but the "enabled warns" case scheduling a real cron must be stopped. If both pass here, that's acceptable — this task's real deliverable is the `index.ts` wiring in Step 3. If the file cannot import, FAIL until Task 5 is present (it is). Confirm both tests pass.

- [ ] **Step 3: Wire into `index.ts`**

Modify `apps/server/src/index.ts` — add the import and the start call inside the `listen` callback, right after `startScheduler();`:

```ts
import { startVwoMonitor } from './services/monitoring/VwoAbMonitor.js';
```

```ts
app.listen({ port: Number(config.PORT), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  startScheduler();
  startVwoMonitor(process.env, app.log);
  app.log.info('Scheduler started');
});
```

- [ ] **Step 4: Document the env vars**

Add to `.env.example` at the repo root (create the file if it does not exist; append these lines if it does):

```dotenv
# VWO A/B liveness monitor (opt-in). Probes the CheckoutService field-validations
# endpoint and posts liveness cards to the Agent-hub Teams channel (reuses TEAMS_WEBHOOK_URL).
VWO_MONITOR_ENABLED=false
VWO_MONITOR_BASE_URL=https://checkout-service-qa-hf.bglobale.com
VWO_MONITOR_CAMPAIGN_KEY=ShippingAddressValidation
VWO_MONITOR_CRON=0 9 * * *
VWO_MONITOR_MERCHANTS=30000603:US:en-US
```

- [ ] **Step 5: Verify build + tests, then commit**

Run: `npx tsc --noEmit` (from `apps/server`) — Expected: no errors.
Run: `npm test -- test/vwoMonitor` — Expected: all monitor tests PASS.

```bash
git add apps/server/src/index.ts apps/server/test/vwoMonitor/startup.test.ts .env.example
git commit -m "feat(vwo-monitor): start monitor on server boot + document env vars"
```

---

## Manual verification (after all tasks)

1. `npx tsc` in `apps/server` (full build to `dist/`).
2. In root `.env` set `VWO_MONITOR_ENABLED=true`, `VWO_MONITOR_CRON=* * * * *` (temporary, every minute), and confirm `TEAMS_WEBHOOK_URL` is set.
3. Restart the server: `node dist/index.js` (the `:3000` owner).
4. Within ~1 minute a ✅ `VWO Liveness — healthy` card should appear in the Agent-hub Teams channel; the server log shows a `[VwoMonitor] … variation=… HTTP 200` line.
5. Temporarily point `VWO_MONITOR_BASE_URL` at an unreachable host (or `VWO_MONITOR_CAMPAIGN_KEY` at a nonexistent campaign) and restart → a ❌ `DOWN` card should post; then revert → the next tick posts a ✅ `RECOVERED` card.
6. Set `VWO_MONITOR_CRON` back to `0 9 * * *` and restart.

## Global self-review checklist (done during authoring)

- Spec coverage: liveness check (Tasks 2/5), daily cron (Tasks 1/5), Teams failure+recovery+heartbeat (Tasks 3/4/5), env config incl. merchant list (Task 1), opt-in kill-switch (Tasks 1/5/6), no DB/migration, no tool-policy change — all covered.
- Type consistency: `Merchant`, `VwoMonitorConfig`, `ProbeResult`, `State`, `Action` defined once and imported; `Action` is the bare string union everywhere; `buildVwoCard(action, lines)` / `postCard(card)` signatures match across Tasks 4 and 5.
- No placeholders: every code step contains complete code and exact run commands.
```
