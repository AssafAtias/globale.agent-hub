# Agent Orchestration (handoff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent ends a run with `<handoff>{"agent":"<slug>","message":"…"}</handoff>`; the source run completes normally AND spawns a child run of the target agent, bounded by depth cap (3) + cycle guard.

**Architecture:** Runner extracts the handoff (reusing the 4A pattern) and posts it with the final result; server resolves the target by slug, applies pure depth/cycle decision logic (`planHandoff`), and spawns a `trigger:'handoff'` run carrying chain metadata in `triggerPayload`. Read-only.

**Tech Stack:** TS runner (Vitest), Fastify+Drizzle server (Jest), React client.

## Global Constraints

- Dynamic handoff via `<handoff>{agent,message}` block; `HANDOFF_PROTOCOL` injected UNCONDITIONALLY (before the agent prompt, NOT inside the `if(workflowText)` gate block).
- Depth cap `MAX_HANDOFF_DEPTH = 3`; refuse when `depth >= MAX_HANDOFF_DEPTH` OR `target === parent.agentId` OR `target ∈ chainAgentIds`. Permits ≤3 hops (child depths 1..3). Chain metadata in child `triggerPayload.handoff = {fromRunId, fromAgentId, depth, chainAgentIds}`.
- Handoff fires ONLY on a clean completion (not gate, not error). Idempotency guard: skip the spawn if the parent run was already `done` before this `/result` call. Spawn wrapped in try/catch (best-effort; never 5xx the runner). Parent always returns `{ok:true}`.
- Target resolved via `AgentRepository.findBySlug` (exists). Child context = `{ 'Handoff request': message }` only (no parent context carry-over).
- `runs.trigger` is plain text → no migration for `'handoff'`; update the schema comment. No new deps.
- `.js` imports; runner Vitest, server Jest. Spec: `docs/superpowers/specs/2026-06-30-agent-orchestration-design.md`.

---

### Task 1: Runner — extractHandoff + protocol + executeJob/poller wiring

**Files:** Modify `packages/runner/src/executor.ts`, `packages/runner/src/poller.ts`; Create `packages/runner/test/handoff.test.ts`.
**Interfaces:** Produces `HandoffPayload`, `extractHandoff(text): {result, handoff|null}`, `HANDOFF_PROTOCOL`; `executeJob` final union gains `handoff?: HandoffPayload | null`.

- [ ] **Step 1: Write the failing test** — `packages/runner/test/handoff.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractHandoff } from '../src/executor.js';

describe('extractHandoff', () => {
  it('returns null + original text when no handoff block', () => {
    const r = extractHandoff('review done, looks good');
    expect(r.handoff).toBeNull();
    expect(r.result).toBe('review done, looks good');
  });
  it('parses a handoff block and strips it from the result', () => {
    const r = extractHandoff('Found issues.\n<handoff>{"agent":"fixer","message":"fix X"}</handoff>');
    expect(r.handoff).toEqual({ agent: 'fixer', message: 'fix X' });
    expect(r.result).toBe('Found issues.');
  });
  it('throws on malformed JSON', () => {
    expect(() => extractHandoff('<handoff>{nope}</handoff>')).toThrow();
  });
  it('throws when agent or message missing', () => {
    expect(() => extractHandoff('<handoff>{"agent":"fixer"}</handoff>')).toThrow();
  });
});
```
- [ ] **Step 2: Run → fail** — `cd packages/runner && npx vitest run handoff`.
- [ ] **Step 3: Implement** — in `executor.ts`, near `extractGate`/`extractMemoryUpdate`:
```ts
export interface HandoffPayload { agent: string; message: string; }

export function extractHandoff(text: string): { result: string; handoff: HandoffPayload | null } {
  const m = text.match(/<handoff>([\s\S]*?)<\/handoff>/);
  if (!m) return { result: text, handoff: null };
  let parsed: HandoffPayload;
  try { parsed = JSON.parse(m[1].trim()); }
  catch { throw new Error(`Agent emitted a malformed <handoff> block: ${m[1].slice(0, 200)}`); }
  if (!parsed.agent || !parsed.message) {
    throw new Error(`Handoff block missing agent/message: ${m[1].slice(0, 200)}`);
  }
  const result = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  return { result, handoff: parsed };
}

const HANDOFF_PROTOCOL =
  'To delegate to another agent, end your turn with exactly one ' +
  '<handoff>{"agent":"<slug>","message":"..."}</handoff> block. This is OPTIONAL — only do it when your task ' +
  'tells you to. The other agent receives ONLY your message as its context, so make the message a complete, ' +
  'self-contained briefing.';
```
Push `HANDOFF_PROTOCOL` into `parts` **unconditionally, immediately before `parts.push(job.agent.prompt)`** (outside any `if(workflowText)`). In `executeJob`, change the final-outcome tail (currently `const { result, note } = extractMemoryUpdate(raw); return { kind:'final' as const, result, note, sessionId };`) to:
```ts
  const { result: afterHandoff, handoff } = extractHandoff(raw);
  const { result, note } = extractMemoryUpdate(afterHandoff);
  return { kind: 'final' as const, result, note, sessionId, handoff };
```
(The gate branch above is unchanged.)
- [ ] **Step 4: Run → pass** — `cd packages/runner && npx vitest run handoff` (4 pass).
- [ ] **Step 5: Poller** — in `poller.ts`, the `kind:'final'` branch's `postResult` call: add `handoff: outcome.handoff` to the body (`{ result: outcome.result, sessionId: outcome.sessionId, handoff: outcome.handoff }`). Widen `postResult`'s body param type with `handoff?: unknown`.
- [ ] **Step 6: Build + tests** — `cd packages/runner && npm run build && npx vitest run` (tsc clean; all pass).
- [ ] **Step 7: Commit** — `git add packages/runner/src/executor.ts packages/runner/src/poller.ts packages/runner/test/handoff.test.ts && git commit -m "feat(runner): handoff extraction + protocol + final-union handoff"`

---

### Task 2: Server — handoff pure helpers + schema comment

**Files:** Create `apps/server/src/services/handoff.ts`; Create `apps/server/test/handoff.test.ts`; Modify `apps/server/src/db/schema.ts` (comment only).
**Interfaces:** Produces `MAX_HANDOFF_DEPTH`, `parseParentChain(json): {depth, chainAgentIds}`, `planHandoff(parent, targetAgentId, message): {spawn:true, childTriggerPayload, context} | {spawn:false, reason}`.

- [ ] **Step 1: Write the failing test** — `apps/server/test/handoff.test.ts`:
```ts
import { parseParentChain, planHandoff, MAX_HANDOFF_DEPTH } from '../src/services/handoff.js';

describe('parseParentChain', () => {
  it('returns depth 0 + [] for a top-level run (no handoff in payload)', () => {
    expect(parseParentChain('{}')).toEqual({ depth: 0, chainAgentIds: [] });
  });
  it('reads depth + chain from payload', () => {
    const p = JSON.stringify({ handoff: { depth: 2, chainAgentIds: ['a', 'b'] } });
    expect(parseParentChain(p)).toEqual({ depth: 2, chainAgentIds: ['a', 'b'] });
  });
  it('returns depth 0 + [] on garbage', () => {
    expect(parseParentChain('not json')).toEqual({ depth: 0, chainAgentIds: [] });
  });
});

describe('planHandoff', () => {
  const parent = (over = {}) => ({ id: 'r1', agentId: 'reviewer', triggerPayload: '{}', ...over });
  it('spawns with depth+1, extended chain, and the message in context', () => {
    const plan = planHandoff(parent(), 'fixer', 'do the fix');
    expect(plan.spawn).toBe(true);
    if (!plan.spawn) return;
    const tp = JSON.parse(plan.childTriggerPayload);
    expect(tp.handoff.depth).toBe(1);
    expect(tp.handoff.chainAgentIds).toEqual(['reviewer']);
    expect(tp.handoff.fromRunId).toBe('r1');
    expect(JSON.parse(plan.context)['Handoff request']).toBe('do the fix');
  });
  it('refuses at depth >= MAX', () => {
    const tp = JSON.stringify({ handoff: { depth: MAX_HANDOFF_DEPTH, chainAgentIds: [] } });
    expect(planHandoff(parent({ triggerPayload: tp }), 'fixer', 'm').spawn).toBe(false);
  });
  it('refuses a self-handoff', () => {
    expect(planHandoff(parent(), 'reviewer', 'm').spawn).toBe(false);
  });
  it('refuses a cycle (target already in chain)', () => {
    const tp = JSON.stringify({ handoff: { depth: 1, chainAgentIds: ['fixer'] } });
    expect(planHandoff(parent({ triggerPayload: tp }), 'fixer', 'm').spawn).toBe(false);
  });
});
```
- [ ] **Step 2: Run → fail** — `cd apps/server && npx jest handoff`.
- [ ] **Step 3: Implement** — create `apps/server/src/services/handoff.ts`:
```ts
export const MAX_HANDOFF_DEPTH = 3;

export function parseParentChain(parentTriggerPayload: string): { depth: number; chainAgentIds: string[] } {
  try {
    const p = JSON.parse(parentTriggerPayload || '{}') as { handoff?: { depth?: unknown; chainAgentIds?: unknown } };
    const h = p.handoff;
    const depth = typeof h?.depth === 'number' ? h.depth : 0;
    const chainAgentIds = Array.isArray(h?.chainAgentIds) ? (h!.chainAgentIds as string[]) : [];
    return { depth, chainAgentIds };
  } catch {
    return { depth: 0, chainAgentIds: [] };
  }
}

export function planHandoff(
  parent: { id: string; agentId: string; triggerPayload: string },
  targetAgentId: string,
  message: string,
): { spawn: true; childTriggerPayload: string; context: string } | { spawn: false; reason: string } {
  const { depth, chainAgentIds } = parseParentChain(parent.triggerPayload);
  if (depth >= MAX_HANDOFF_DEPTH) return { spawn: false, reason: `max handoff depth ${MAX_HANDOFF_DEPTH} reached` };
  if (targetAgentId === parent.agentId) return { spawn: false, reason: 'self-handoff refused' };
  if (chainAgentIds.includes(targetAgentId)) return { spawn: false, reason: 'cycle: target already in chain' };
  return {
    spawn: true,
    childTriggerPayload: JSON.stringify({
      handoff: { fromRunId: parent.id, fromAgentId: parent.agentId, depth: depth + 1, chainAgentIds: [...chainAgentIds, parent.agentId] },
    }),
    context: JSON.stringify({ 'Handoff request': message }),
  };
}
```
- [ ] **Step 4: Run → pass** — `cd apps/server && npx jest handoff` (all pass).
- [ ] **Step 5: Schema comment** — in `apps/server/src/db/schema.ts`, update the `trigger` column comment from `// 'webhook' | 'manual'` to `// 'webhook' | 'manual' | 'schedule' | 'handoff'`.
- [ ] **Step 6: tsc** — `cd apps/server && npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `git add apps/server/src/services/handoff.ts apps/server/test/handoff.test.ts apps/server/src/db/schema.ts && git commit -m "feat(server): handoff planHandoff/parseParentChain helpers + trigger comment"`

---

### Task 3: Server — /result handoff spawn + idempotency guard

**Files:** Modify `apps/server/src/api/routes/runs.ts`; extend `apps/server/test/runs.test.ts`.
**Interfaces:** Consumes `planHandoff` (Task 2), `AgentRepository.findBySlug`, `RunRepository.create`.

- [ ] **Step 1: Write failing tests** — append to `apps/server/test/runs.test.ts` (reuse `createAgent` + runner registration; create a target agent whose `slugify(name)` is predictable, e.g. name `'fixer'` → slug `'fixer'`):
```ts
  async function completeWithHandoff(runId: string, token: string, handoff: unknown) {
    return app.inject({ method: 'POST', url: `/api/runs/${runId}/result`, headers: { 'x-runner-token': token },
      payload: { result: 'reviewed', handoff } });
  }

  it('a handoff to a real agent completes the parent AND spawns a handoff child', async () => {
    const reviewer = await createAgent();                 // pr-review
    const fixer = await createAgentNamed('fixer');        // see helper note below
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: reviewer.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await completeWithHandoff(id, reg.token, { agent: 'fixer', message: 'fix the bug' });
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json() as Array<any>;
    expect(runs.find((r) => r.id === id).status).toBe('done');
    const child = runs.find((r) => r.trigger === 'handoff' && r.agentId === fixer.id);
    expect(child).toBeTruthy();
    expect(JSON.parse(child.context)['Handoff request']).toBe('fix the bug');
  });

  it('an unknown handoff target completes the parent with no child', async () => {
    const reviewer = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: reviewer.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await completeWithHandoff(id, reg.token, { agent: 'nope-not-real', message: 'x' });
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json() as Array<any>;
    expect(runs.find((r) => r.id === id).status).toBe('done');
    expect(runs.some((r) => r.trigger === 'handoff')).toBe(false);
  });
```
Add a small helper near `createAgent`:
```ts
  async function createAgentNamed(name: string) {
    const res = await app.inject({ method: 'POST', url: '/api/agents',
      payload: { name, type: 'pr-review', model: 'claude-haiku-4-5', prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [] } });
    return res.json() as { id: string };
  }
```
(Confirm `slugify('fixer') === 'fixer'`; if the project's slugify lowercases/hyphenates, pick a name that slugifies to a known value and use that as the handoff `agent`.)
- [ ] **Step 2: Run → fail** — `cd apps/server && npx jest runs -t "handoff"`.
- [ ] **Step 3: Implement** — in `apps/server/src/api/routes/runs.ts`:
  - Import `planHandoff` from `../../services/handoff.js`.
  - Widen the `/result` body schema: add `handoff: Type.Optional(Type.Any())`.
  - At the TOP of the success (non-gate, non-error) branch: `const wasAlreadyDone = RunRepository.findById(req.params.id)?.status === 'done';`
  - AFTER the existing `complete(...)` + ResultDispatcher fan-out in that branch, add the guarded spawn block (verbatim from the spec):
```ts
      if (!wasAlreadyDone && req.body.handoff?.agent && completedRun) {
        try {
          const target = AgentRepository.findBySlug(req.body.handoff.agent);
          if (!target) { app.log.warn({ slug: req.body.handoff.agent }, 'handoff target not found'); }
          else {
            const plan = planHandoff(completedRun, target.id, String(req.body.handoff.message ?? ''));
            if (plan.spawn) {
              const child = RunRepository.create({ agentId: target.id, trigger: 'handoff', triggerPayload: plan.childTriggerPayload, context: plan.context });
              app.log.info({ parent: completedRun.id, child: child.id, target: target.id }, 'handoff spawned');
            } else {
              app.log.warn({ parent: completedRun.id, reason: plan.reason }, 'handoff refused');
            }
          }
        } catch (e) { app.log.error(e, 'handoff spawn failed'); }
      }
```
(`completedRun` is the row already re-fetched after `complete` in the success branch. If it's fetched only inside the `if (req.body.result)` sub-block, ensure it's in scope where the handoff block runs.)
- [ ] **Step 4: Run → pass + full suite** — `cd apps/server && npx jest runs && npx tsc --noEmit && npx jest`.
- [ ] **Step 5: Commit** — `git add apps/server/src/api/routes/runs.ts apps/server/test/runs.test.ts && git commit -m "feat(api): spawn handoff child on /result completion (guarded, idempotent)"`

---

### Task 4: Client — handoff lineage caption

**Files:** Modify the run list and/or `apps/client/src/pages/RunDetailPage.tsx` (find via `grep -rn "trigger\|triggerPayload\|run.trigger" apps/client/src`).
**Interfaces:** Consumes `run.triggerPayload` (already on the `Run` type as a JSON string — confirm; if not present, add `triggerPayload?: string` to the `Run` interface in `client.ts`).

- [ ] **Step 1: Add the caption** — where a run is rendered (run list row and/or RunDetailPage header), when `run.trigger === 'handoff'`, parse `run.triggerPayload` (guarded try/catch) and show a small caption like `↳ handoff (depth N)` using `triggerPayload.handoff.depth`. Optionally resolve `triggerPayload.handoff.fromAgentId` to a name via the loaded agents list if one is in scope; otherwise show the depth only. Example:
```tsx
{run.trigger === 'handoff' && (() => {
  let depth: number | undefined;
  try { depth = JSON.parse(run.triggerPayload ?? '{}')?.handoff?.depth; } catch { /* ignore */ }
  return <Typography variant="caption" color="text.secondary">↳ handoff{depth != null ? ` (depth ${depth})` : ''}</Typography>;
})()}
```
Use the file's existing MUI imports; keep it minimal.
- [ ] **Step 2: Build** — `cd apps/client && npx tsc --noEmit && npm run build`.
- [ ] **Step 3: Commit** — `git add apps/client/src && git commit -m "feat(client): handoff lineage caption on spawned runs"`
- [ ] **Step 4: Manual verification (controller-run, post-merge)** — rebuild server+runner from dist, restart; create a reviewer agent whose prompt ends with a `<handoff>` to a `fixer` agent on issues, and a fixer agent; trigger the reviewer; confirm a `trigger:'handoff'` fixer run is spawned with the message as context, and that a depth-3 chain stops (no 4th spawn). Record in the ledger.

---

## Self-Review Notes

- **Spec coverage:** extractHandoff + HANDOFF_PROTOCOL (unconditional) + executeJob handoff union + poller (Task 1); MAX/parseParentChain/planHandoff depth+cycle + schema comment (Task 2); /result guarded+idempotent spawn + findBySlug + body schema (Task 3); client lineage (Task 4). Read-only, no migration, no deps — honored.
- **Type consistency:** `HandoffPayload`, `extractHandoff`, `parseParentChain`, `planHandoff`, `MAX_HANDOFF_DEPTH`, `trigger:'handoff'`, `triggerPayload.handoff{fromRunId,fromAgentId,depth,chainAgentIds}` consistent across tasks.
- **Critical safety:** depth `>= MAX` + self + cycle guards (Task 2); idempotency `wasAlreadyDone` + try/catch (Task 3) prevent duplicate spawns / retry storms.
- **Placeholder scan:** none — code complete (the slugify assumption in Task 3 is flagged for the implementer to confirm).
