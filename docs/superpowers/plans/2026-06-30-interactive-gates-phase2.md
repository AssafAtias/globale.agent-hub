# Interactive Gates Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive gate state machine — an agent with a workflow pauses at a `<gate>` block, the run parks in `waiting_approval`, the operator approves/answers/rejects on the dashboard, and the same `claude` session resumes via `--resume`. Read-only tools only.

**Architecture:** Runner emits/parses `<gate>` and drives `claude --session-id`/`--resume` (composed with 1A's read-only `toolArgs`); server `RunRepository` gate lifecycle + `/result` gate branch + `/respond`; client gate panel.

**Tech Stack:** Node + TS runner (Vitest), Fastify + Drizzle + better-sqlite3 server (Jest), React + react-query client (Vitest).

## Global Constraints

- Session-resume: fresh → `--session-id <id> --append-system-prompt-file "<sys>"`; resume → `--resume <id>` (NO sys file). `toolArgs` (1A read-only) passed on BOTH; the sys-prompt assembly still runs on resume, only the file write + flag are skipped.
- `claimNext` MUST capture `pendingResponse` before nulling it and re-inject the captured value into the returned row (else the user's response is silently dropped). DB column ends nulled.
- Gate path never completes: `/result` with `gate` → `pauseForGate`, returns before ResultDispatcher/Teams (those stay on the `complete` path only).
- `/respond` → 409 when run not `waiting_approval`; `reject` → `RunRepository.reject` (terminal, sets `finishedAt`); `approve`/`answer` → `resumeWithResponse` (→ `pending`).
- `renderResponse` uses `r.message ?? ''` (no literal "undefined").
- No DB migration (columns exist). No new deps. `.js` imports. Server tests Jest; runner tests Vitest; client Vitest.
- Spec: `docs/superpowers/specs/2026-06-30-interactive-gates-phase2-design.md`.

---

### Task 1: Gate parsing (runner)

**Files:** Create `packages/runner/test/gate.test.ts`; Modify `packages/runner/src/executor.ts`.
**Interfaces:** Produces `GatePayload` type, `extractGate(text): { gate: GatePayload | null }`, and a `GATE_PROTOCOL` string const.

- [ ] **Step 1: Write the failing test** — create `packages/runner/test/gate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractGate } from '../src/executor.js';

describe('extractGate', () => {
  it('returns null when no gate block', () => {
    expect(extractGate('all done, opened MR !12').gate).toBeNull();
  });
  it('parses a valid gate block', () => {
    const text = 'Summary.\n<gate>{"id":"confirm","summary":"s","question":"q","kind":"approve_reject"}</gate>';
    expect(extractGate(text).gate?.id).toBe('confirm');
    expect(extractGate(text).gate?.kind).toBe('approve_reject');
  });
  it('throws on malformed gate JSON', () => {
    expect(() => extractGate('<gate>{not json}</gate>')).toThrow();
  });
  it('throws when required fields missing', () => {
    expect(() => extractGate('<gate>{"summary":"s"}</gate>')).toThrow();
  });
});
```
- [ ] **Step 2: Run → fail** — `cd packages/runner && npx vitest run gate` (FAIL: extractGate not exported).
- [ ] **Step 3: Implement** — in `packages/runner/src/executor.ts`, add near `extractMemoryUpdate`:
```ts
export interface GatePayload {
  id: string; summary: string; question: string;
  kind: 'approve_reject' | 'input' | 'choice'; options?: string[];
}

export function extractGate(text: string): { gate: GatePayload | null } {
  const m = text.match(/<gate>([\s\S]*?)<\/gate>/);
  if (!m) return { gate: null };
  let parsed: GatePayload;
  try { parsed = JSON.parse(m[1].trim()); }
  catch { throw new Error(`Agent emitted a malformed <gate> block: ${m[1].slice(0, 200)}`); }
  if (!parsed.id || !parsed.question || !parsed.kind) {
    throw new Error(`Gate block missing required fields: ${m[1].slice(0, 200)}`);
  }
  return { gate: parsed };
}

const GATE_PROTOCOL =
  'Each turn is non-interactive. When the workflow says STOP at a ⛔ gate, end your turn ' +
  'with exactly one <gate>{...}</gate> JSON block and STOP — do not proceed past it. ' +
  'You will be re-invoked with the user\'s response and continue. JSON shape: ' +
  '{ "id": string, "summary": string, "question": string, "kind": "approve_reject"|"input"|"choice", "options"?: string[] }. ' +
  'When fully done, end normally with NO gate block.';
```
(If `GATE_PROTOCOL` is unused until Task 2, prefix with `// eslint-disable-next-line` is unnecessary — TS won't error on an unused const at module scope; leave it. It is consumed in Task 2.)
- [ ] **Step 4: Run → pass** — `cd packages/runner && npx vitest run gate` (4 pass).
- [ ] **Step 5: Commit** — `git add packages/runner/src/executor.ts packages/runner/test/gate.test.ts && git commit -m "feat(runner): gate parsing + protocol preamble"`

---

### Task 2: executeJob union + session resume + poller (runner)

**Files:** Modify `packages/runner/src/executor.ts`, `packages/runner/src/poller.ts`.
**Interfaces:** Consumes `extractGate`/`GATE_PROTOCOL` (Task 1). Produces `executeJob` returning `{kind:'final',result,note,sessionId} | {kind:'gate',gate,sessionId}`; `runClaude(model,systemPrompt,userMessage,cwd,toolArgs,opts:{sessionId,resume})`; `renderResponse`; `Job.run.sessionId?`/`pendingResponse?`.

- [ ] **Step 1: Add Job.run fields + renderResponse + randomUUID import** — in `executor.ts`, add `import { randomUUID } from 'crypto';` (top). In the `Job` interface, add to `run`: `sessionId?: string; pendingResponse?: string | null;`. Add:
```ts
function renderResponse(pending?: string | null): string {
  if (!pending) return 'Continue.';
  try {
    const r = JSON.parse(pending) as { decision: string; message?: string };
    if (r.decision === 'approve') return 'The user approved. Continue with the next step of the workflow.';
    return `The user responded:\n${r.message ?? ''}\n\nContinue with the workflow.`;
  } catch { return 'Continue.'; }
}
```
- [ ] **Step 2: Inject GATE_PROTOCOL + change executeJob tail** — where the system-prompt `parts` are assembled, push `GATE_PROTOCOL` immediately before the workflow section **only when `workflowText` is non-empty** (i.e. inside the existing `if (workflowText) { … }`, push `GATE_PROTOCOL` before pushing the workflow). Change the tail of `executeJob` (currently `const raw = await runClaude(job.agent.model, systemPrompt, contextText, cwd, toolArgs); return extractMemoryUpdate(raw);`) to:
```ts
  const fresh = !job.run.sessionId;
  const sessionId = job.run.sessionId ?? randomUUID();
  const userMessage = fresh ? contextText : renderResponse(job.run.pendingResponse);
  const raw = await runClaude(job.agent.model, systemPrompt, userMessage, cwd, toolArgs, { sessionId, resume: !fresh });
  const { gate } = extractGate(raw);
  if (gate) return { kind: 'gate' as const, gate, sessionId };
  const { result, note } = extractMemoryUpdate(raw);
  return { kind: 'final' as const, result, note, sessionId };
```
Update `executeJob`'s return type annotation to the union (or let it infer). `cwd`/`toolArgs` computation above stays unchanged.
- [ ] **Step 3: Update runClaude** — change signature to `async function runClaude(model: string, systemPrompt: string, userMessage: string, cwd: string, toolArgs: string[], opts: { sessionId: string; resume: boolean }): Promise<string>`. Keep `const sysFile = join(tmpdir(), …)` declaration. Wrap the `writeFileSync(sysFile, systemPrompt, 'utf8')` in `if (!opts.resume) { … }`. Build session/prompt args:
```ts
  const sessionArgs = opts.resume ? ['--resume', opts.sessionId] : ['--session-id', opts.sessionId];
  const promptArgs = opts.resume ? [] : ['--append-system-prompt-file', `"${sysFile}"`];
```
Change the spawn args array to `['-p', '--model', model, '--output-format', 'json', ...sessionArgs, ...promptArgs, ...toolArgs]`. Leave the `finally { try { unlinkSync(sysFile); } catch {} }` as-is (no-ops on resume). Everything else unchanged.
- [ ] **Step 4: Update poller** — in `packages/runner/src/poller.ts`, replace the success block (currently `const { result, note } = await executeJob(...); await postResult(config, job.run.id, { result }); if (note) await postMemory(...)`) with:
```ts
        const outcome = await executeJob(job, config.localReposRoot, config.skillsDir, config.workflowsDir, memory, config.toolsEnabled);
        if (outcome.kind === 'gate') {
          await postResult(config, job.run.id, { gate: outcome.gate, sessionId: outcome.sessionId });
          console.log(`[runner] Run ${job.run.id} paused at gate "${outcome.gate.id}"`);
        } else {
          await postResult(config, job.run.id, { result: outcome.result, sessionId: outcome.sessionId });
          if (outcome.note) await postMemory(config, job.run.agentId, { runId: job.run.id, note: outcome.note });
          console.log(`[runner] Run ${job.run.id} completed`);
        }
```
Widen `postResult`'s body parameter type to `{ result?: string; error?: string; gate?: unknown; sessionId?: string }`.
- [ ] **Step 5: Build + gate test** — `cd packages/runner && npm run build && npx vitest run` (tsc compiles; gate + existing tests pass).
- [ ] **Step 6: Commit** — `git add packages/runner/src/executor.ts packages/runner/src/poller.ts && git commit -m "feat(runner): gate/final union, session resume composed with toolArgs"`

---

### Task 3: RunRepository gate lifecycle (server)

**Files:** Modify `apps/server/src/services/RunRepository.ts`; extend `apps/server/test/runRepository.test.ts`.
**Interfaces:** Produces `pauseForGate(id,sessionId,gateJson)`, `resumeWithResponse(id,responseJson)`, `reject(id,message)`; `complete`/`fail` optional `sessionId?`; `claimNext` captures+nulls+re-injects `pendingResponse`.

- [ ] **Step 1: Write failing tests** — append to `apps/server/test/runRepository.test.ts` (the in-memory `runs` DDL there already has `session_id`/`pending_gate`/`pending_response`; confirm — if not, add them):
```ts
describe('gate lifecycle', () => {
  it('pauseForGate parks in waiting_approval with sessionId + gate', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.pauseForGate(r.id, 'sess-1', '{"id":"g","question":"q","kind":"approve_reject","summary":"s"}');
    const row = RunRepository.findById(r.id)!;
    expect(row.status).toBe('waiting_approval');
    expect(row.sessionId).toBe('sess-1');
    expect(row.pendingGate).toContain('"id":"g"');
  });
  it('resumeWithResponse re-queues with pendingResponse and clears the gate', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.pauseForGate(r.id, 'sess-1', '{"id":"g"}');
    RunRepository.resumeWithResponse(r.id, '{"decision":"approve"}');
    const row = RunRepository.findById(r.id)!;
    expect(row.status).toBe('pending');
    expect(row.pendingResponse).toContain('approve');
    expect(row.pendingGate).toBeNull();
  });
  it('claimNext returns the captured pendingResponse then nulls the column', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.pauseForGate(r.id, 'sess-1', '{"id":"g"}');
    RunRepository.resumeWithResponse(r.id, '{"decision":"approve"}');
    const claimed = RunRepository.claimNext('runner-1')!;
    expect(claimed.pendingResponse).toContain('approve');
    expect(RunRepository.findById(r.id)!.pendingResponse).toBeNull();
  });
  it('reject marks the run rejected', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.reject(r.id, 'not needed');
    expect(RunRepository.findById(r.id)!.status).toBe('rejected');
  });
  it('complete persists an optional sessionId', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.complete(r.id, 'done', 'sess-2');
    expect(RunRepository.findById(r.id)!.sessionId).toBe('sess-2');
  });
});
```
- [ ] **Step 2: Run → fail** — `cd apps/server && npx jest runRepository -t "gate lifecycle"` (methods undefined).
- [ ] **Step 3: Implement** — in `RunRepository.ts` add the three methods and amend `complete`/`fail`/`claimNext`:
```ts
  pauseForGate(id: string, sessionId: string, gateJson: string) {
    getDb().update(runs).set({ status: 'waiting_approval', sessionId, pendingGate: gateJson, runnerId: null })
      .where(eq(runs.id, id)).run();
  },
  resumeWithResponse(id: string, responseJson: string) {
    getDb().update(runs).set({ status: 'pending', pendingResponse: responseJson, pendingGate: null })
      .where(eq(runs.id, id)).run();
  },
  reject(id: string, message: string) {
    getDb().update(runs).set({ status: 'rejected', error: message, pendingGate: null, finishedAt: new Date().toISOString() })
      .where(eq(runs.id, id)).run();
  },
```
Change `complete`/`fail` to accept `sessionId?: string` and spread `...(sessionId ? { sessionId } : {})` into their `.set({...})`. In `claimNext`, inside the transaction, capture and re-inject:
```ts
    const claim = sqlite.transaction(() => {
      const pending = db.select().from(runs).where(eq(runs.status, 'pending')).get();
      if (!pending) return null;
      const capturedResponse = pending.pendingResponse;
      db.update(runs).set({ status: 'running', runnerId, startedAt, pendingResponse: null })
        .where(and(eq(runs.id, pending.id), eq(runs.status, 'pending'))).run();
      const claimed = db.select().from(runs).where(eq(runs.id, pending.id)).get();
      return claimed ? { ...claimed, pendingResponse: capturedResponse } : null;
    });
    return claim() as RunRow | null;
```
- [ ] **Step 4: Run → pass** — `cd apps/server && npx jest runRepository` (all pass).
- [ ] **Step 5: Commit** — `git add apps/server/src/services/RunRepository.ts apps/server/test/runRepository.test.ts && git commit -m "feat(runs): gate lifecycle + claimNext captures pendingResponse + sessionId on complete/fail"`

---

### Task 4: /result gate branch + /respond (server)

**Files:** Modify `apps/server/src/api/routes/runs.ts`; extend `apps/server/test/runs.test.ts`.
**Interfaces:** Consumes Task 3 methods. Produces gate-aware `/result`; `POST /api/runs/:id/respond`.

- [ ] **Step 1: Write failing tests** — append to `apps/server/test/runs.test.ts` (reuse its existing `createAgent`/`registerRunner` helpers; if `registerRunner` doesn't exist, register via `POST /api/runners/register`):
```ts
  it('result with a gate parks the run in waiting_approval', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/result`, headers: { 'x-runner-token': reg.token },
      payload: { sessionId: 'sess-1', gate: { id: 'g', summary: 's', question: 'q', kind: 'approve_reject' } } });
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json();
    expect(run.status).toBe('waiting_approval');
    expect(run.sessionId).toBe('sess-1');
  });
  it('respond approve re-queues a waiting run', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/result`, headers: { 'x-runner-token': reg.token },
      payload: { sessionId: 'sess-1', gate: { id: 'g', summary: 's', question: 'q', kind: 'approve_reject' } } });
    const res = await app.inject({ method: 'POST', url: `/api/runs/${id}/respond`, payload: { decision: 'approve' } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json().status).toBe('pending');
  });
  it('respond returns 409 when run is not waiting_approval', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/runs/${id}/respond`, payload: { decision: 'approve' } })).statusCode).toBe(409);
  });
  it('respond reject marks the run rejected', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/result`, headers: { 'x-runner-token': reg.token },
      payload: { sessionId: 'sess-1', gate: { id: 'g', summary: 's', question: 'q', kind: 'approve_reject' } } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/respond`, payload: { decision: 'reject', message: 'no' } });
    expect((await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json().status).toBe('rejected');
  });
```
- [ ] **Step 2: Run → fail** — `cd apps/server && npx jest runs -t "gate\|respond\|waiting"` (gate not handled; /respond 404).
- [ ] **Step 3: Extend /result** — widen its body schema: add `gate: Type.Optional(Type.Any())`, `sessionId: Type.Optional(Type.String())`. As the FIRST thing in the handler (after the runner-token check): `if (req.body.gate) { RunRepository.pauseForGate(req.params.id, req.body.sessionId ?? '', JSON.stringify(req.body.gate)); return reply.status(200).send({ ok: true }); }`. In the error branch change `RunRepository.fail(req.params.id, req.body.error)` → `RunRepository.fail(req.params.id, req.body.error, req.body.sessionId)`. In the success branch change `RunRepository.complete(req.params.id, req.body.result ?? '')` → `RunRepository.complete(req.params.id, req.body.result ?? '', req.body.sessionId)`. ResultDispatcher/Teams fanout stays in the success branch unchanged.
- [ ] **Step 4: Add /respond** — register a new route (anywhere in the plugin):
```ts
    app.post('/api/runs/:id/respond', {
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({
          decision: Type.Union([Type.Literal('approve'), Type.Literal('reject'), Type.Literal('answer')]),
          message: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Any(), 404: Type.Any(), 409: Type.Any() },
      },
    }, async (req, reply) => {
      const run = RunRepository.findById(req.params.id);
      if (!run) return reply.status(404).send({ error: 'Not found' });
      if (run.status !== 'waiting_approval') return reply.status(409).send({ error: 'Run is not awaiting approval' });
      if (req.body.decision === 'reject') {
        RunRepository.reject(req.params.id, req.body.message ?? 'Rejected by user');
      } else {
        RunRepository.resumeWithResponse(req.params.id, JSON.stringify({ decision: req.body.decision, message: req.body.message }));
      }
      return reply.status(200).send({ ok: true });
    });
```
- [ ] **Step 5: Run → pass + full suite** — `cd apps/server && npx jest runs && npx tsc --noEmit && npx jest`.
- [ ] **Step 6: Commit** — `git add apps/server/src/api/routes/runs.ts apps/server/test/runs.test.ts && git commit -m "feat(api): gate-aware /result + /respond endpoint"`

---

### Task 5: Client API + dashboard state (client)

**Files:** Modify `apps/client/src/api/client.ts`, `apps/client/src/lib/dashboard.ts`; extend `apps/client/src/lib/dashboard.test.ts`.
**Interfaces:** Produces `api.runs.respond`; `Run` fields `sessionId?`/`pendingGate?`; `waiting_approval → 'waiting'` worker-card state.

- [ ] **Step 1: Write the failing test** — add to `apps/client/src/lib/dashboard.test.ts` (mirror the existing `buildWorkerCards` cases — reuse its `agent`/`run` factory helpers):
```ts
  it('maps a waiting_approval run to waiting', () => {
    const cards = buildWorkerCards(
      [agent({ id: 'aw', name: 'GatedAgent' })],
      [run({ id: 'rw', agentId: 'aw', status: 'waiting_approval' })],
    );
    expect(cards.find((c) => c.agent.id === 'aw')?.state).toBe('waiting');
  });
```
- [ ] **Step 2: Run → fail** — `cd apps/client && npx vitest run dashboard` (state not 'waiting').
- [ ] **Step 3: Implement** — in `lib/dashboard.ts`, in the status→state logic of `buildWorkerCards`, add a branch mapping `waiting_approval` → `'waiting'` (mirror `pending → 'queued'`); if the state is a TS union type, add `'waiting'` to it (and to the `WorkerState` palette type if dashboard styling references it — if `'waiting'` isn't a valid `WorkerState`, map to the closest existing reviewing/queued state instead and note it; prefer adding `'waiting'`). In `api/client.ts`: add `sessionId?: string | null; pendingGate?: string | null;` to the `Run` interface, and inside the `runs` api object:
```ts
    respond: (id: string, body: { decision: 'approve' | 'reject' | 'answer'; message?: string }) =>
      req<{ ok: boolean }>(`/api/runs/${id}/respond`, { method: 'POST', body: JSON.stringify(body) }),
```
- [ ] **Step 4: Run → pass + tsc** — `cd apps/client && npx vitest run dashboard && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add apps/client/src/api/client.ts apps/client/src/lib/dashboard.ts apps/client/src/lib/dashboard.test.ts && git commit -m "feat(client): waiting_approval state + runs.respond api + Run gate fields"`

---

### Task 6: Gate approval UI (client)

**Files:** Create `apps/client/src/hooks/useRespondToRun.ts`; modify the run-detail component (find via grep for where `run.status`/`run.result` renders, e.g. `apps/client/src/pages/RunDetailPage.tsx`).
**Interfaces:** Consumes `api.runs.respond` (Task 5). Produces `useRespondToRun()` + a gate panel shown when `run.status === 'waiting_approval'`.

- [ ] **Step 1: Add the hook** — create `apps/client/src/hooks/useRespondToRun.ts`:
```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useRespondToRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject' | 'answer'; message?: string }) =>
      api.runs.respond(v.id, { decision: v.decision, message: v.message }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
}
```
- [ ] **Step 2: Render the gate panel** — locate the run-detail component (`grep -rl "pendingGate\|run.result\|run.status" apps/client/src/pages apps/client/src/components`). When `run.status === 'waiting_approval' && run.pendingGate`, parse the gate JSON and render `summary` + `question` with MUI components consistent with the file, plus action buttons wired to `useRespondToRun()`:
  - `approve_reject` kind → **Approve** (`respond.mutate({ id: run.id, decision: 'approve' })`) + **Reject** (`{ decision: 'reject', message }`).
  - `input`/`choice` kind → a `TextField` (value in local state `answer`) + **Send** (`{ decision: 'answer', message: answer }`) + **Reject**.
  Use the existing MUI imports in that file. Keep it minimal and styled like the surrounding component. Example skeleton (adapt to the file's UI lib):
```tsx
{run.status === 'waiting_approval' && run.pendingGate && (() => {
  const gate = JSON.parse(run.pendingGate);
  return (
    <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'warning.main', borderRadius: 1 }}>
      <Typography variant="subtitle2">{gate.summary}</Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>{gate.question}</Typography>
      {gate.kind !== 'approve_reject' && (
        <TextField fullWidth size="small" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your response" sx={{ mb: 1 }} />
      )}
      <Button variant="contained" onClick={() => respond.mutate({ id: run.id, decision: gate.kind === 'approve_reject' ? 'approve' : 'answer', message: answer })}>
        {gate.kind === 'approve_reject' ? 'Approve' : 'Send'}
      </Button>
      <Button color="error" onClick={() => respond.mutate({ id: run.id, decision: 'reject', message: answer })} sx={{ ml: 1 }}>Reject</Button>
    </Box>
  );
})()}
```
Add `const [answer, setAnswer] = useState('')` and `const respond = useRespondToRun()` to the component. Ensure the client `Run` type has `pendingGate` (added in Task 5).
- [ ] **Step 3: Build** — `cd apps/client && npx tsc --noEmit && npm run build` (both succeed).
- [ ] **Step 4: Commit** — `git add apps/client/src/hooks/useRespondToRun.ts <run-detail file> && git commit -m "feat(client): gate approval panel for waiting_approval runs"`
- [ ] **Step 5: Manual verification (controller-run, post-merge)** — rebuild server+runner from dist, restart; trigger a `ticket-to-code` agent with a `workflow` set; confirm it parks at a gate (`waiting_approval`), the dashboard shows the gate panel, Approve resumes the same session (run goes `pending`→`running`), and Reject marks it `rejected`.

---

## Self-Review Notes

- **Spec coverage:** gate parsing + protocol (Task 1); executeJob union + session resume composed with toolArgs + renderResponse(`?? ''`) + sysFile guard + poller union (Task 2); RunRepository gate lifecycle + claimNext capture/re-inject + complete/fail sessionId (Task 3); /result gate branch (ResultDispatcher only on complete) + /respond 409/reject/approve (Task 4); client respond api + waiting state + Run fields (Task 5); gate panel + hook (Task 6). Read-only (no MR write), no migration — honored.
- **Type consistency:** `GatePayload`, `extractGate`, `renderResponse`, `executeJob` union, `runClaude(...,toolArgs,opts)`, `Job.run.sessionId/pendingResponse`, `pauseForGate/resumeWithResponse/reject`, `complete/fail(...,sessionId?)`, `api.runs.respond`, `Run.pendingGate/sessionId` — consistent across tasks.
- **Critical correctness:** claimNext re-injects the captured `pendingResponse` (Task 3 Step 3) — the spec-flagged silent-drop trap.
- **Placeholder scan:** none — every code step is complete.
