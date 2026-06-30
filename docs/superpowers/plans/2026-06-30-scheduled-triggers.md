# Scheduled (cron) Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire agents on a cron schedule — a server scheduler creates `trigger:'schedule'` runs for agents with a `triggerRules.cron`, each carrying a default context; the runner executes them.

**Architecture:** `croner`-based pure due-logic (`isDue`) + a DB-backed dedup (`RunRepository.lastScheduledRun`) drive a 60s `setInterval` tick (`Scheduler`) started from `index.ts`. The cron string lives in the agent's `triggerRules` JSON, set via a new `TriggerRulesForm` field.

**Tech Stack:** Fastify + TypeScript (`apps/server`), Jest, `croner` 9; React + MUI client.

## Global Constraints

- Schedule = cron string in `triggerRules.cron`. Due-logic uses `new Cron(expr).previousRuns(1, now)[0] ?? null` (NOT the arg-less `previousRun()`); construct `Cron` with no callback (calc only); invalid expr → `isDue` returns false.
- Dedup via `RunRepository.lastScheduledRun(agentId)` (most recent `trigger:'schedule'` run, `desc(createdAt)`, limit 1). Survives restarts; one catch-up fire per missed slot, never a storm; no duplicate within a slot (tick is synchronous).
- Scheduled run: `trigger:'schedule'`, `triggerPayload:'{}'`, `context: buildScheduledContext(agent.repos)` (preamble + repo list). Runner's `LocalEnricher` adds the first repo's `CLAUDE.md` on top, as for every run.
- `AgentRepository.findAll()` already excludes archived agents — scheduler filters only on `agent.enabled`.
- `croner` pinned `^9.0.0`. No DB migration, no client/API type change beyond the `TriggerRules` interface. `.js` imports; Jest globals.
- Spec: `docs/superpowers/specs/2026-06-30-scheduled-triggers-design.md`.

---

### Task 1: croner dep + schedule.ts pure helpers

**Files:**
- Modify: `apps/server/package.json` (add `croner`)
- Create: `apps/server/src/services/schedule.ts`
- Test: `apps/server/test/schedule.test.ts`

**Interfaces:**
- Produces: `isDue(cronExpr: string, lastScheduledAtIso: string | null, now: Date): boolean`; `parseCronFromTriggerRules(triggerRulesJson: string): string | null`; `buildScheduledContext(reposJson: string): string`.

- [ ] **Step 1: Add the dependency**

In `apps/server/package.json`, add to `dependencies`: `"croner": "^9.0.0"`. Then run `npm install` from the repo root (workspaces) or `apps/server`:
Run: `cd apps/server && npm install`
Expected: `croner` installed, no errors.

- [ ] **Step 2: Write the failing test**

Create `apps/server/test/schedule.test.ts`:

```ts
import { isDue, parseCronFromTriggerRules, buildScheduledContext } from '../src/services/schedule.js';

describe('isDue', () => {
  const now = new Date('2026-06-30T12:30:30Z'); // mid-minute, so the prev every-minute slot is unambiguously 12:30:00
  it('is due when never fired and a previous slot exists', () => {
    expect(isDue('* * * * *', null, now)).toBe(true);
  });
  it('is NOT due when the last fire is after the current slot', () => {
    expect(isDue('* * * * *', '2026-06-30T12:30:15Z', now)).toBe(false);
  });
  it('is due when the last fire predates the current slot', () => {
    expect(isDue('* * * * *', '2026-06-30T12:29:30Z', now)).toBe(true);
  });
  it('is NOT due for an invalid cron expression', () => {
    expect(isDue('not a cron', null, now)).toBe(false);
  });
});

describe('parseCronFromTriggerRules', () => {
  it('extracts a cron string', () => {
    expect(parseCronFromTriggerRules('{"events":[],"cron":"0 2 * * *"}')).toBe('0 2 * * *');
  });
  it('returns null when cron is absent/empty', () => {
    expect(parseCronFromTriggerRules('{"events":[]}')).toBeNull();
    expect(parseCronFromTriggerRules('{"cron":"  "}')).toBeNull();
  });
  it('returns null on garbage JSON', () => {
    expect(parseCronFromTriggerRules('not json')).toBeNull();
  });
});

describe('buildScheduledContext', () => {
  it('always includes the preamble and lists repos', () => {
    const ctx = JSON.parse(buildScheduledContext('["bitbucket:g/core","gitlab:x/y"]'));
    expect(ctx['Scheduled run']).toMatch(/scheduled/i);
    expect(ctx['Repos']).toBe('bitbucket:g/core, gitlab:x/y');
  });
  it('omits Repos for empty/garbage repos', () => {
    expect(JSON.parse(buildScheduledContext('[]'))['Repos']).toBeUndefined();
    expect(JSON.parse(buildScheduledContext('nope'))['Repos']).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && npx jest test/schedule.test.ts`
Expected: FAIL — module `../src/services/schedule.js` not found.

- [ ] **Step 4: Implement schedule.ts**

Create `apps/server/src/services/schedule.ts`:

```ts
import { Cron } from 'croner';

/** True when a scheduled slot has elapsed since the last scheduled run (or it never ran). */
export function isDue(cronExpr: string, lastScheduledAtIso: string | null, now: Date): boolean {
  try {
    const prev = new Cron(cronExpr).previousRuns(1, now)[0] ?? null;
    if (!prev) return false;
    if (lastScheduledAtIso === null) return true;
    return new Date(lastScheduledAtIso) < prev;
  } catch {
    return false;
  }
}

/** Extract a non-empty `cron` string from an agent's triggerRules JSON, else null. */
export function parseCronFromTriggerRules(triggerRulesJson: string): string | null {
  try {
    const rules = JSON.parse(triggerRulesJson || '{}') as { cron?: unknown };
    const cron = typeof rules.cron === 'string' ? rules.cron.trim() : '';
    return cron.length > 0 ? cron : null;
  } catch {
    return null;
  }
}

const SCHEDULED_PREAMBLE =
  'This is a scheduled (cron) run with no triggering event. Use your available tools to inspect the repo(s) and carry out your task.';

/** Default context for a scheduled run: a preamble plus the agent's repo list. */
export function buildScheduledContext(reposJson: string): string {
  const ctx: Record<string, string> = { 'Scheduled run': SCHEDULED_PREAMBLE };
  try {
    const repos = JSON.parse(reposJson || '[]');
    if (Array.isArray(repos) && repos.length > 0) ctx['Repos'] = repos.join(', ');
  } catch { /* preamble only */ }
  return JSON.stringify(ctx);
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/server && npx jest test/schedule.test.ts && npx tsc --noEmit`
Expected: all tests pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json apps/server/package-lock.json apps/server/src/services/schedule.ts apps/server/test/schedule.test.ts
git commit -m "feat(server): add croner + schedule pure helpers"
```
(If the lockfile lives at repo root, add that path instead; include whatever `npm install` changed.)

---

### Task 2: RunRepository.lastScheduledRun

**Files:**
- Modify: `apps/server/src/services/RunRepository.ts`
- Test: `apps/server/test/runRepository.test.ts`

**Interfaces:**
- Produces: `RunRepository.lastScheduledRun(agentId: string): RunRow | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/runRepository.test.ts`:

```ts
import { getDb, resetDb } from '../src/db/client.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL, trigger_payload TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT,
      result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, session_id TEXT, pending_gate TEXT, pending_response TEXT, reply_to TEXT
    );
  `);
}

beforeEach(() => { resetDb(); setup(); });

describe('RunRepository.lastScheduledRun', () => {
  it('returns the most recent schedule-trigger run for the agent', () => {
    RunRepository.create({ agentId: 'a', trigger: 'schedule', triggerPayload: '{}', context: '{}' });
    const second = RunRepository.create({ agentId: 'a', trigger: 'schedule', triggerPayload: '{}', context: '{}' });
    const last = RunRepository.lastScheduledRun('a');
    expect(last?.id).toBe(second.id);
  });
  it('ignores non-schedule triggers', () => {
    RunRepository.create({ agentId: 'a', trigger: 'webhook', triggerPayload: '{}', context: '{}' });
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    expect(RunRepository.lastScheduledRun('a')).toBeNull();
  });
  it('returns null when the agent has no schedule runs', () => {
    expect(RunRepository.lastScheduledRun('nobody')).toBeNull();
  });
});
```

> Note: `RunRepository.create` sets `createdAt` from the real clock; the two creates in test 1 are ms apart. If the ordering ever proves flaky on a fast machine, the `desc(createdAt)` tie is broken arbitrarily — acceptable for this test, but if needed the second create can be asserted via `RunRepository.findAll()` length instead. (Leave as-is unless it actually flakes.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/runRepository.test.ts`
Expected: FAIL — `lastScheduledRun` is not a function.

- [ ] **Step 3: Implement the method**

In `apps/server/src/services/RunRepository.ts`:

Change the drizzle import to add `desc`:
```ts
import { eq, and, desc } from 'drizzle-orm';
```

Add the method to the `RunRepository` object (e.g. after `findById`):
```ts
  lastScheduledRun(agentId: string) {
    return getDb().select().from(runs)
      .where(and(eq(runs.agentId, agentId), eq(runs.trigger, 'schedule')))
      .orderBy(desc(runs.createdAt))
      .limit(1)
      .get() ?? null;
  },
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd apps/server && npx jest test/runRepository.test.ts && npx tsc --noEmit`
Expected: 3 tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/RunRepository.ts apps/server/test/runRepository.test.ts
git commit -m "feat(server): add RunRepository.lastScheduledRun"
```

---

### Task 3: Scheduler + index.ts wiring

**Files:**
- Create: `apps/server/src/services/Scheduler.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `isDue`, `parseCronFromTriggerRules`, `buildScheduledContext` (Task 1); `RunRepository.lastScheduledRun` + `create` (Task 2); `AgentRepository.findAll`.
- Produces: `runDueAgents(now: Date): void`; `startScheduler(intervalMs?: number): () => void`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/scheduler.test.ts`:

```ts
import { getDb, resetDb } from '../src/db/client.js';
import { runDueAgents } from '../src/services/Scheduler.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const c = (getDb(':memory:') as any).$client;
  c.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, model TEXT NOT NULL,
      prompt TEXT NOT NULL, repos TEXT NOT NULL, trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]', focus TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0, workflow TEXT, teams_target TEXT
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL, trigger_payload TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT,
      result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, session_id TEXT, pending_gate TEXT, pending_response TEXT, reply_to TEXT
    );
  `);
  return c;
}

function addAgent(c: any, id: string, opts: { enabled?: number; archived?: number; cron?: string } = {}) {
  const rules = JSON.stringify(opts.cron ? { events: [], cron: opts.cron } : { events: [] });
  c.prepare(
    `INSERT INTO agents (id,name,type,model,prompt,repos,trigger_rules,outputs,enabled,created_at,archived)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, id, 'pr-review', 'm', 'p', '["bitbucket:g/core"]', rules, '[]',
        opts.enabled ?? 1, '2026-01-01T00:00:00Z', opts.archived ?? 0);
}

let client: any;
beforeEach(() => { resetDb(); client = setup(); });

const scheduleRuns = () => RunRepository.findAll().filter(r => r.trigger === 'schedule');

describe('runDueAgents', () => {
  it('creates exactly one schedule run, only for the due enabled cron agent', () => {
    addAgent(client, 'due', { cron: '* * * * *' });
    addAgent(client, 'nocron', {});
    addAgent(client, 'disabled', { enabled: 0, cron: '* * * * *' });
    addAgent(client, 'archived', { archived: 1, cron: '* * * * *' });
    runDueAgents(new Date());
    const runs = scheduleRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].agentId).toBe('due');
    expect(JSON.parse(runs[0].context)['Scheduled run']).toMatch(/scheduled/i);
  });

  it('does not create a duplicate within the same slot', () => {
    addAgent(client, 'due', { cron: '* * * * *' });
    const now = new Date();
    runDueAgents(now);
    runDueAgents(now);
    expect(scheduleRuns()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/scheduler.test.ts`
Expected: FAIL — module `../src/services/Scheduler.js` not found.

- [ ] **Step 3: Implement Scheduler.ts**

Create `apps/server/src/services/Scheduler.ts`:

```ts
import { AgentRepository } from './AgentRepository.js';
import { RunRepository } from './RunRepository.js';
import { isDue, parseCronFromTriggerRules, buildScheduledContext } from './schedule.js';

/** One scheduler pass: create a schedule run for every enabled agent whose cron slot is due. */
export function runDueAgents(now: Date): void {
  for (const agent of AgentRepository.findAll()) {
    try {
      if (!agent.enabled) continue; // findAll already excludes archived
      const cron = parseCronFromTriggerRules(agent.triggerRules);
      if (!cron) continue;
      const last = RunRepository.lastScheduledRun(agent.id)?.createdAt ?? null;
      if (isDue(cron, last, now)) {
        RunRepository.create({
          agentId: agent.id,
          trigger: 'schedule',
          triggerPayload: '{}',
          context: buildScheduledContext(agent.repos),
        });
      }
    } catch (e) {
      console.error('[Scheduler] agent', agent.id, 'failed:', e);
    }
  }
}

/** Start the 60s scheduler tick (runs once immediately). Returns a stop function. */
export function startScheduler(intervalMs = 60_000): () => void {
  const tick = () => {
    try { runDueAgents(new Date()); }
    catch (e) { console.error('[Scheduler] tick failed:', e); }
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/scheduler.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Wire into index.ts**

In `apps/server/src/index.ts`, add the import:
```ts
import { startScheduler } from './services/Scheduler.js';
```
And inside the `app.listen(..., (err) => { ... })` callback, after the `if (err) { ... process.exit(1); }` block, add:
```ts
  startScheduler();
  app.log.info('Scheduler started');
```

- [ ] **Step 6: Typecheck + full suite**

Run: `cd apps/server && npx tsc --noEmit && npx jest`
Expected: tsc clean; full suite green (existing + schedule + runRepository + scheduler).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/Scheduler.ts apps/server/src/index.ts apps/server/test/scheduler.test.ts
git commit -m "feat(server): cron scheduler tick + index wiring"
```

---

### Task 4: Client cron field

**Files:**
- Modify: `apps/client/src/components/TriggerRulesForm.tsx`

**Interfaces:**
- Consumes: nothing (the cron string rides in the existing `triggerRules` JSON saved by the agent form).
- Produces: a `Schedule (cron, optional)` input bound to `value.cron`.

- [ ] **Step 1: Add the field + type**

In `apps/client/src/components/TriggerRulesForm.tsx`:

Extend the interface:
```ts
interface TriggerRules { events: string[]; branchFilter?: string; jiraLabel?: string; cron?: string; }
```

Add a `TextField` after the Jira Label field (before the closing `</Box>`):
```tsx
      <TextField
        label="Schedule (cron, optional)"
        value={value.cron ?? ''}
        onChange={e => onChange({ ...value, cron: e.target.value || undefined })}
        placeholder="0 2 * * 1-5"
        size="small"
        helperText="Runs the agent on this cron schedule (host timezone). Leave empty for no schedule."
      />
```

- [ ] **Step 2: Typecheck + build the client**

Run: `cd apps/client && npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/TriggerRulesForm.tsx
git commit -m "feat(client): add cron schedule field to TriggerRulesForm"
```

- [ ] **Step 4: Manual verification (controller-run, post-merge)**

Not auto-tested end-to-end. After merge: `npm install` + rebuild server `dist` + restart; set an agent's Schedule field to `* * * * *` (every minute) and enable it; confirm a `schedule`-trigger run appears within ~1 minute and that re-ticking doesn't duplicate it within the minute; then clear the cron. Record outcome in the ledger.

---

## Self-Review Notes

- **Spec coverage:** croner dep + isDue (previousRuns(1,now)) + parseCronFromTriggerRules + buildScheduledContext (Task 1); lastScheduledRun dedup with `desc` import (Task 2); runDueAgents (enabled-only, findAll excludes archived) + startScheduler (60s, immediate tick, stop fn) + index.ts wiring after the err-check (Task 3); client cron field + TriggerRules type (Task 4). trigger:'schedule', empty-ish default context, no migration — all covered.
- **Type consistency:** `isDue`/`parseCronFromTriggerRules`/`buildScheduledContext` signatures consistent Task 1→3; `lastScheduledRun(agentId): RunRow|null` Task 2→3; `runDueAgents(now)`/`startScheduler(intervalMs)` Task 3; `TriggerRules.cron?` Task 4.
- **Placeholder scan:** none — all code complete.
