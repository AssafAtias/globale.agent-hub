# Live Run Logs in Run Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live per-step activity timeline in Run Detail by streaming `claude` `stream-json` events from the runner to an in-memory store the UI polls.

**Architecture:** `runClaude` switches to `--output-format stream-json --verbose`, emits per-line `ProgressEvent`s (fire-and-forget `POST /api/runs/:id/events`) and reconstructs the final result from the terminal `result` event (byte-identical to json mode). Server keeps a bounded in-memory `RunEventStore`; Run Detail polls `GET /api/runs/:id/events`. `RUN_EVENTS_ENABLED` kill-switch reverts to the json one-shot.

**Tech Stack:** TS runner (Vitest), Fastify + TypeBox server (Jest), React + react-query client.

## Global Constraints

- **Result-contract equivalence is the #1 requirement.** The string `runClaude` returns in streaming mode must equal json mode's: from the terminal `{type:'result', subtype, is_error, result}` event → if `is_error || (subtype && subtype!=='success')` throw; else `(result ?? '').trim() || '(no output)'`. No result event → throw. Verified against a real captured fixture (already at `packages/runner/test/fixtures/stream-json-sample.jsonl`; its result event = `"ping"`, matching json mode).
- `RUN_EVENTS_ENABLED` (default true; `!['false','0','no'].includes((env ?? '').trim().toLowerCase())`) — false → unchanged json one-shot path, no events.
- Event posting is **fire-and-forget** (`.catch(()=>{})`) — never blocks or fails a run. `seq` is `let seq=0` per claimed job.
- `RunEventStore` in-memory, bounded: per-run cap 200, LRU over 50 runs (Map insertion order; evict `map.keys().next().value`).
- The `try/finally` guarding `sysFile` (write guarded by `!resume`) wraps the ENTIRE streaming path.
- No DB migration, no new deps. `.js` imports; runner Vitest, server Jest.
- Spec: `docs/superpowers/specs/2026-06-30-live-run-logs-design.md`. Real event shapes (verified): terminal `{type:'result',subtype,is_error,result}`; `{type:'assistant',message:{content:[{type:'text',text}|{type:'tool_use',name,input}|{type:'thinking',...}]}}`; `{type:'system',subtype:'init'|...}`.

---

### Task 1: Runner pure parsers + fixture (safety-critical)

**Files:** Modify `packages/runner/src/executor.ts`; Create `packages/runner/test/streamParse.test.ts`; (fixture `packages/runner/test/fixtures/stream-json-sample.jsonl` already present — commit it).
**Interfaces:** Produces `ProgressEvent`, `OnProgress`, `extractStreamResult(lines: string[]): string`, `summarizeStreamEvent(evt: unknown): ProgressEvent[]`.

- [ ] **Step 1: Confirm the fixture exists** — `ls packages/runner/test/fixtures/stream-json-sample.jsonl` (a real captured transcript; last line is the `result` event with `result:"ping"`). If missing, capture one: `echo "reply with exactly: ping" | claude -p --output-format stream-json --verbose --model claude-haiku-4-5 > packages/runner/test/fixtures/stream-json-sample.jsonl`.

- [ ] **Step 2: Write the failing tests** — create `packages/runner/test/streamParse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractStreamResult, summarizeStreamEvent } from '../src/executor.js';

const fixture = readFileSync(join(__dirname, 'fixtures/stream-json-sample.jsonl'), 'utf8').trim().split('\n');

describe('extractStreamResult', () => {
  it('returns the terminal result event string (real fixture)', () => {
    expect(extractStreamResult(fixture)).toBe('ping');
  });
  it('throws when is_error is true', () => {
    const lines = ['{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'];
    expect(() => extractStreamResult(lines)).toThrow();
  });
  it('throws when subtype is not success', () => {
    const lines = ['{"type":"result","subtype":"error_max_turns","is_error":false,"result":"x"}'];
    expect(() => extractStreamResult(lines)).toThrow();
  });
  it('throws when there is no result event', () => {
    const lines = ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{"content":[]}}'];
    expect(() => extractStreamResult(lines)).toThrow();
  });
  it('empty/whitespace result -> "(no output)"', () => {
    const lines = ['{"type":"result","subtype":"success","is_error":false,"result":"   "}'];
    expect(extractStreamResult(lines)).toBe('(no output)');
  });
});

describe('summarizeStreamEvent', () => {
  it('system init -> session started', () => {
    expect(summarizeStreamEvent({ type: 'system', subtype: 'init' })).toEqual([{ kind: 'system', label: 'session started' }]);
  });
  it('assistant text block -> responding event', () => {
    const evts = summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at foo.ts now' }] } });
    expect(evts).toEqual([{ kind: 'assistant', label: 'responding', detail: 'Looking at foo.ts now' }]);
  });
  it('assistant tool_use block -> tool event with name + input summary', () => {
    const evts = summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/foo.ts' } }] } });
    expect(evts).toEqual([{ kind: 'tool', label: 'Read', detail: 'src/foo.ts' }]);
  });
  it('thinking / result / unknown -> []', () => {
    expect(summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } })).toEqual([]);
    expect(summarizeStreamEvent({ type: 'result', subtype: 'success' })).toEqual([]);
    expect(summarizeStreamEvent('garbage')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run → fail** — `cd packages/runner && npx vitest run streamParse` (functions not exported).

- [ ] **Step 4: Implement the parsers** — in `packages/runner/src/executor.ts`, add near `extractMemoryUpdate`:
```ts
export interface ProgressEvent { kind: string; label: string; detail?: string }
export type OnProgress = (e: ProgressEvent) => void;

/** Reconstruct the final result string from a stream-json transcript — must match json mode. */
export function extractStreamResult(lines: string[]): string {
  let resultEvt: { subtype?: string; is_error?: boolean; result?: string } | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let e: any;
    try { e = JSON.parse(t); } catch { continue; }
    if (e && e.type === 'result') resultEvt = e; // last result event wins
  }
  if (!resultEvt) throw new Error('claude stream-json produced no result event');
  if (resultEvt.is_error || (resultEvt.subtype && resultEvt.subtype !== 'success')) {
    throw new Error(`claude CLI error (${resultEvt.subtype ?? 'unknown'}): ${(resultEvt.result ?? 'no detail').toString().slice(0, 500)}`);
  }
  return (resultEvt.result ?? '').trim() || '(no output)';
}

function summarizeToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const v = o.file_path ?? o.command ?? o.pattern ?? o.path ?? o.url;
  if (typeof v === 'string') return v.slice(0, 120);
  try { return JSON.stringify(o).slice(0, 120); } catch { return undefined; }
}

/** Map one parsed stream-json event to zero+ readable progress events. */
export function summarizeStreamEvent(evt: unknown): ProgressEvent[] {
  if (!evt || typeof evt !== 'object') return [];
  const o = evt as any;
  if (o.type === 'system' && o.subtype === 'init') return [{ kind: 'system', label: 'session started' }];
  if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
    const out: ProgressEvent[] = [];
    for (const b of o.message.content) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        out.push({ kind: 'assistant', label: 'responding', detail: b.text.trim().slice(0, 120) });
      } else if (b?.type === 'tool_use') {
        out.push({ kind: 'tool', label: typeof b.name === 'string' ? b.name : 'tool', detail: summarizeToolInput(b.input) });
      }
    }
    return out;
  }
  return [];
}
```

- [ ] **Step 5: Run → pass** — `cd packages/runner && npx vitest run streamParse` (all pass, incl. the real-fixture `=== 'ping'`).

- [ ] **Step 6: Commit** — `git add packages/runner/src/executor.ts packages/runner/test/streamParse.test.ts packages/runner/test/fixtures/stream-json-sample.jsonl && git commit -m "feat(runner): stream-json result extractor + event summarizer (real fixture)"`

---

### Task 2: Runner streaming wiring (runClaude + config + executeJob + poller)

**Files:** Modify `packages/runner/src/executor.ts`, `packages/runner/src/config.ts`, `packages/runner/src/poller.ts`.
**Interfaces:** Consumes Task 1's parsers. Produces the streaming `runClaude` branch + `config.runEventsEnabled` + `executeJob(..., toolsEnabled, runEventsEnabled, onProgress?)` + poller `postEvent`/`onProgress`.

- [ ] **Step 1: config.ts** — add to `RunnerConfig` and `loadConfig()`:
```ts
  runEventsEnabled: boolean;
```
```ts
    runEventsEnabled: !['false', '0', 'no'].includes((process.env.RUN_EVENTS_ENABLED ?? '').trim().toLowerCase()),
```

- [ ] **Step 2: runClaude streaming branch** — change the `runClaude` signature to `runClaude(model, systemPrompt, userMessage, cwd, toolArgs, opts: { sessionId: string; resume: boolean; streaming: boolean; onProgress?: OnProgress })`. Keep the current json body for `!opts.streaming`. For `opts.streaming`, inside the SAME `try/finally` (sysFile write still guarded by `!opts.resume`, unlink in finally): spawn with `stream-json --verbose`, buffer lines, emit progress, and resolve via `extractStreamResult`:
```ts
      const child = spawn(
        'claude',
        ['-p', '--model', model, '--output-format', 'stream-json', '--verbose', ...sessionArgs, ...promptArgs, ...toolArgs],
        { cwd, env, shell: true },
      );
      const lines: string[] = [];
      let buf = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`)); }, CLI_TIMEOUT_MS);
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          lines.push(line);
          try { for (const ev of summarizeStreamEvent(JSON.parse(line))) opts.onProgress?.(ev); } catch { /* skip non-JSON line */ }
        }
      });
      let err = '';
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (buf.trim()) lines.push(buf); // flush trailing partial line (may be the result event)
        if (code !== 0) { reject(new Error(`claude CLI exited ${code}: ${(err.trim() || lines.join('\n')).slice(0, 500)}`)); return; }
        try { resolve(extractStreamResult(lines)); } catch (e) { reject(e); }
      });
      child.stdin.write(userMessage); child.stdin.end();
```
(Mirror the existing promise/`runClaude` structure; the json branch stays for the fallback. Factor shared spawn-env setup as in the current code.)

- [ ] **Step 3: executeJob** — change signature to `executeJob(job, localReposRoot, skillsDir, workflowsDir, memory, toolsEnabled, runEventsEnabled, onProgress?)`. In its `runClaude(...)` call, pass `{ sessionId, resume: !fresh, streaming: runEventsEnabled, onProgress }`.

- [ ] **Step 4: poller** — in the per-job `try` block, before calling `executeJob`:
```ts
        let seq = 0;
        const onProgress = (e: { kind: string; label: string; detail?: string }) =>
          postEvent(config, job.run.id, { seq: seq++, ...e }).catch(() => { /* best-effort */ });
```
Pass `config.runEventsEnabled` and `onProgress` as the new trailing args to `executeJob(...)`. Add a `postEvent` helper near `postResult`:
```ts
async function postEvent(config: RunnerConfig, runId: string, body: { seq: number; kind: string; label: string; detail?: string }): Promise<void> {
  await fetch(`${config.orchestratorUrl}/api/runs/${runId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-runner-token': config.runnerToken },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 5: Build + tests** — `cd packages/runner && npm run build && npx vitest run` (tsc clean; all pass).
- [ ] **Step 6: Commit** — `git add packages/runner/src/executor.ts packages/runner/src/config.ts packages/runner/src/poller.ts && git commit -m "feat(runner): stream-json runClaude branch + RUN_EVENTS_ENABLED + postEvent"`

---

### Task 3: Server RunEventStore + /events endpoints

**Files:** Create `apps/server/src/services/RunEventStore.ts`; Modify `apps/server/src/api/routes/runs.ts`; Test `apps/server/test/runEventStore.test.ts` + extend `apps/server/test/runs.test.ts`.
**Interfaces:** Produces `RunEventStore.append/list`; `POST`/`GET /api/runs/:id/events`.

- [ ] **Step 1: Write the failing store test** — `apps/server/test/runEventStore.test.ts`:
```ts
import { RunEventStore } from '../src/services/RunEventStore.js';

describe('RunEventStore', () => {
  it('appends and lists in order', () => {
    RunEventStore.append('r1', { seq: 0, kind: 'tool', label: 'Read' });
    RunEventStore.append('r1', { seq: 1, kind: 'assistant', label: 'responding' });
    const out = RunEventStore.list('r1');
    expect(out.map((e) => e.seq)).toEqual([0, 1]);
  });
  it('returns [] for unknown run', () => {
    expect(RunEventStore.list('nope')).toEqual([]);
  });
  it('caps to last 200 per run', () => {
    for (let i = 0; i < 250; i++) RunEventStore.append('rcap', { seq: i, kind: 'x', label: 'y' });
    const out = RunEventStore.list('rcap');
    expect(out).toHaveLength(200);
    expect(out[0].seq).toBe(50); // first 50 dropped
  });
});
```
(Note: the store is a module singleton; these tests share it — use distinct run ids per test as above.)

- [ ] **Step 2: Run → fail** — `cd apps/server && npx jest runEventStore`.
- [ ] **Step 3: Implement the store** — `apps/server/src/services/RunEventStore.ts`:
```ts
export interface RunEvent { seq: number; kind: string; label: string; detail?: string }

const MAX_PER_RUN = 200;
const MAX_RUNS = 50;
const store = new Map<string, RunEvent[]>();

export const RunEventStore = {
  append(runId: string, evt: RunEvent): void {
    let arr = store.get(runId);
    if (!arr) {
      if (store.size >= MAX_RUNS) {
        const oldest = store.keys().next().value as string | undefined;
        if (oldest !== undefined) store.delete(oldest);
      }
      arr = [];
      store.set(runId, arr);
    }
    arr.push(evt);
    if (arr.length > MAX_PER_RUN) arr.splice(0, arr.length - MAX_PER_RUN);
  },
  list(runId: string): RunEvent[] {
    return store.get(runId) ?? [];
  },
};
```

- [ ] **Step 4: Run → pass** — `cd apps/server && npx jest runEventStore`.
- [ ] **Step 5: Write the failing route tests** — append to `apps/server/test/runs.test.ts`:
```ts
  it('POST /events appends (with runner token) and GET /events returns them', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    const post = await app.inject({ method: 'POST', url: `/api/runs/${id}/events`, headers: { 'x-runner-token': reg.token },
      payload: { seq: 0, kind: 'tool', label: 'Read', detail: 'foo.ts' } });
    expect(post.statusCode).toBe(200);
    const events = (await app.inject({ method: 'GET', url: `/api/runs/${id}/events` })).json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 0, kind: 'tool', label: 'Read', detail: 'foo.ts' });
  });
  it('POST /events rejects a bad runner token with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/whatever/events', headers: { 'x-runner-token': 'nope' },
      payload: { seq: 0, kind: 'x', label: 'y' } });
    expect(res.statusCode).toBe(401);
  });
```
- [ ] **Step 6: Run → fail** — `cd apps/server && npx jest runs -t "events"`.
- [ ] **Step 7: Add the routes** — in `apps/server/src/api/routes/runs.ts`, import `RunEventStore`, and register:
```ts
    app.post('/api/runs/:id/events', {
      schema: {
        params: Type.Object({ id: Type.String() }),
        headers: Type.Object({ 'x-runner-token': Type.String() }, { additionalProperties: true }),
        body: Type.Object({ seq: Type.Number(), kind: Type.String(), label: Type.String(), detail: Type.Optional(Type.String()) }),
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: Type.Any() },
      },
    }, async (req, reply) => {
      const runner = RunnerRepository.findByToken(req.headers['x-runner-token'] as string);
      if (!runner) return reply.status(401).send({ error: 'Invalid runner token' });
      RunEventStore.append(req.params.id, req.body);
      return reply.status(200).send({ ok: true });
    });

    app.get('/api/runs/:id/events', {
      schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Array(Type.Any()) } },
    }, async (req) => RunEventStore.list(req.params.id));
```
(Register these BEFORE the `/api/runs/:id` GET if route-precedence matters — distinct suffix `/events`, so order is not critical, but keep them with the other run routes. `RunnerRepository` is already imported in this file.)
- [ ] **Step 8: Run → pass + full suite + tsc** — `cd apps/server && npx jest runs && npx tsc --noEmit && npx jest`.
- [ ] **Step 9: Commit** — `git add apps/server/src/services/RunEventStore.ts apps/server/src/api/routes/runs.ts apps/server/test/runEventStore.test.ts apps/server/test/runs.test.ts && git commit -m "feat(server): in-memory RunEventStore + /events POST/GET"`

---

### Task 4: Client — events API + useRunEvents + Run Detail timeline

**Files:** Modify `apps/client/src/api/client.ts`, `apps/client/src/pages/RunDetailPage.tsx`; Create `apps/client/src/hooks/useRunEvents.ts`.
**Interfaces:** Consumes `GET /api/runs/:id/events`.

- [ ] **Step 1: API + type** — in `apps/client/src/api/client.ts` add a `RunEvent` interface (`{ seq: number; kind: string; label: string; detail?: string }`) and inside the `runs` object: `events: (id: string) => req<RunEvent[]>(\`/api/runs/${id}/events\`),`.
- [ ] **Step 2: Hook** — create `apps/client/src/hooks/useRunEvents.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useRunEvents(id: string, status: string | undefined) {
  const isTerminal = status === 'done' || status === 'failed';
  return useQuery({
    queryKey: ['runEvents', id],
    queryFn: () => api.runs.events(id),
    refetchInterval: isTerminal ? false : 2000,
  });
}
```
- [ ] **Step 3: Timeline in RunDetailPage** — in `apps/client/src/pages/RunDetailPage.tsx`, call `const { data: events } = useRunEvents(run.id, run.status);` and render a timeline section (use the file's existing MUI imports — `Box`, `Typography`, etc.):
```tsx
{events && events.length > 0 && (
  <Box sx={{ mt: 2 }}>
    <Typography variant="subtitle2" gutterBottom>Activity</Typography>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {events.map((e) => (
        <Typography key={e.seq} variant="body2" color="text.secondary">
          <strong>{e.kind === 'tool' ? `🔧 ${e.label}` : e.label}</strong>{e.detail ? ` — ${e.detail}` : ''}
        </Typography>
      ))}
    </Box>
  </Box>
)}
```
Place it above the final `result`/`error` blocks so it reads top-to-bottom (activity → result).
- [ ] **Step 4: Build** — `cd apps/client && npx tsc --noEmit && npm run build`.
- [ ] **Step 5: Commit** — `git add apps/client/src && git commit -m "feat(client): live run activity timeline in Run Detail"`
- [ ] **Step 6: Manual verification (controller-run, post-merge)** — rebuild server+runner dist + restart; trigger a real agent run; confirm Run Detail's Activity timeline populates with tool/assistant events in ~real time and the final result still appears. Then `RUN_EVENTS_ENABLED=false` + restart → confirm runs still complete with no events (fallback intact).

---

## Self-Review Notes
- **Spec coverage:** extractStreamResult (contract equivalence, real fixture) + summarizeStreamEvent (Task 1); runClaude streaming branch + sysFile try/finally + flush remainder + RUN_EVENTS_ENABLED + executeJob sig + poller seq/postEvent fire-and-forget (Task 2); RunEventStore bounded+LRU + POST(token)/GET events (Task 3); api+useRunEvents(stop-when-terminal)+timeline (Task 4). Kill-switch, no migration, no deps — honored.
- **Type consistency:** `ProgressEvent`/`OnProgress`/`extractStreamResult(string[]):string`/`summarizeStreamEvent`/`RunEvent{seq,kind,label,detail}`/`executeJob(...,toolsEnabled,runEventsEnabled,onProgress?)`/`runClaude(...,opts{streaming,onProgress})` consistent across tasks.
- **Safety:** result-contract equivalence tested against the REAL fixture (Task 1); kill-switch preserves json path (Task 2); fire-and-forget events can't break a run (Task 2); store bounded (Task 3).
- **Placeholder scan:** none — code complete.
