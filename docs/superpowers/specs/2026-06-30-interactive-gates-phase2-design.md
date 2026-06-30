# Interactive Gated Workflow — Phase 2 (refreshed) — Design

**Date:** 2026-06-30
**Repo:** `globale.agent-hub`
**Status:** Approved (pending spec review)
**Roadmap:** Phase 4A. Supersedes the Phase-2 half of `docs/superpowers/plans/2026-06-28-interactive-gated-workflow.md`, which drifted from the executor after Phase 1A added `toolArgs`/`toolsEnabled`.

## Problem

The gated-workflow Phase 1 shipped (ticket selection + workflow-markdown injection; single-shot, gates not interactive) and is on master, including the `runs.sessionId` / `runs.pendingGate` / `runs.pendingResponse` columns and `agents.workflow`. Phase 2 — the **interactive gate state machine** (agent pauses at a ⛔ gate → operator approves/answers/rejects on the dashboard → the same `claude` session resumes) — was never implemented, and the original Phase-2 plan now conflicts with the post-1A executor.

## Goal

Implement the interactive gate mechanism on the **current** codebase: an agent with a workflow can end a turn with a `<gate>{…}</gate>` block; the run parks in `waiting_approval`; the operator responds on the dashboard; the runner resumes the same `claude` session via `--resume`. Composes cleanly with Phase 1A's read-only `toolArgs`.

## Non-goals (YAGNI)

- **No write/git tools, no MR opening.** The agent runs with the existing **read-only** tools; it *proposes* (e.g. describes the MR it would open). Actually opening MRs is deferred to a future write-tools phase.
- No auto-timeout of a parked gate, no worktree isolation, no webhook-triggered gating (manual `ticket-to-code` runs are the path), no `mr`/`draft_mr` dispatch.
- No DB migration — the columns already exist.

## Decisions

| Question | Decision |
|---|---|
| Approach | **Session-resume state machine** (June Approach A): stable per-run `--session-id`; pause via `<gate>` block; resume via `--resume` |
| Tool access | Existing **read-only** `toolArgs` (1A); passed on BOTH fresh and resume invocations |
| Deliverable | **Gate mechanism only** — pause/resume/approve; no real MR write |
| Migration | **None** — `sessionId`/`pendingGate`/`pendingResponse`/`workflow` columns already on master |

## Components

### Runner — `packages/runner/src/executor.ts`
- **`GatePayload`** type: `{ id: string; summary: string; question: string; kind: 'approve_reject'|'input'|'choice'; options?: string[] }`.
- **`extractGate(text): { gate: GatePayload | null }`** — match `<gate>([\s\S]*?)</gate>`; none → `{gate:null}`; parse JSON (throw on malformed); require `id`/`question`/`kind` (throw if missing).
- **Gate protocol preamble** (`GATE_PROTOCOL` const): instructs the agent that each turn is non-interactive, to end with exactly one `<gate>{…}</gate>` and STOP at a ⛔ gate, that it'll be re-invoked with the user's response, and to end with NO gate block when fully done. Pushed into `parts` **only when `workflowText` is non-empty**, immediately before the workflow section.
- **`executeJob` return type changes** to a union (keep the same 6-param signature `(job, localReposRoot, skillsDir, workflowsDir, memory, toolsEnabled)`):
  `Promise<{ kind: 'final'; result: string; note: string | null; sessionId: string } | { kind: 'gate'; gate: GatePayload; sessionId: string }>`.
- **Session logic** at the tail of `executeJob`:
  ```ts
  const fresh = !job.run.sessionId;
  const sessionId = job.run.sessionId ?? randomUUID();
  const userMessage = fresh ? contextText : renderResponse(job.run.pendingResponse);
  const raw = await runClaude(job.agent.model, systemPrompt, userMessage, cwd, toolArgs, { sessionId, resume: !fresh });
  const { gate } = extractGate(raw);
  if (gate) return { kind: 'gate', gate, sessionId };
  const { result, note } = extractMemoryUpdate(raw);
  return { kind: 'final', result, note, sessionId };
  ```
  (`cwd` and `toolArgs` are computed exactly as today — `cwd = toolsEnabled ? (repoPaths[0] ?? localReposRoot) : localReposRoot`, `toolArgs = buildToolArgs({enabled: toolsEnabled, repoPaths})`.)
- **`renderResponse(pending?: string | null): string`** — `'Continue.'` when absent; parse `{decision, message?}`: `approve` → "The user approved. Continue with the next step of the workflow."; else → "The user responded:\n<message>\n\nContinue with the workflow." (try/catch → 'Continue.').
- **`runClaude` signature gains session opts AFTER `toolArgs`** (compose with 1A):
  `runClaude(model, systemPrompt, userMessage, cwd, toolArgs: string[], opts: { sessionId: string; resume: boolean })`.
  - Session args: `opts.resume ? ['--resume', opts.sessionId] : ['--session-id', opts.sessionId]`.
  - System prompt: only on fresh — `opts.resume ? [] : ['--append-system-prompt-file', '"<sysFile>"']`. **Guard the sysFile write + unlink behind `!opts.resume`** (a resumed session already carries the system prompt).
  - **`toolArgs` are passed on BOTH fresh and resume** (`--allowedTools`/`--permission-mode dontAsk`/`--disallowedTools`/`--add-dir` are per-invocation, not persisted in the session) — append `...toolArgs` to the spawn args in both cases.
  - Spawn args fresh: `['-p','--model',model,'--output-format','json','--session-id',id,'--append-system-prompt-file','"<sys>"', ...toolArgs]`; resume: `['-p','--model',model,'--output-format','json','--resume',id, ...toolArgs]`. Everything else (env strip, `shell:true`, JSON parse, timeout) unchanged.
- **`Job.run`** gains `sessionId?: string`, `pendingResponse?: string | null`. `isJob` still accepts jobs lacking those fields (don't tighten the guard).

### Runner — `packages/runner/src/poller.ts`
- Replace the `executeJob` success handling: it now returns a union. On `kind:'gate'` → `postResult(config, job.run.id, { gate: outcome.gate, sessionId: outcome.sessionId })`; on `kind:'final'` → `postResult(config, job.run.id, { result: outcome.result, sessionId: outcome.sessionId })` then `postMemory` if `note`. Keep passing `config.toolsEnabled` to `executeJob`. Widen `postResult`'s body type to `{ result?: string; error?: string; gate?: unknown; sessionId?: string }`.

### Server — `packages/server/.../RunRepository.ts`
- **`pauseForGate(id, sessionId, gateJson)`** → set `status:'waiting_approval'`, `sessionId`, `pendingGate: gateJson`, `runnerId: null`.
- **`resumeWithResponse(id, responseJson)`** → set `status:'pending'`, `pendingResponse: responseJson`, `pendingGate: null`.
- **`reject(id, message)`** → set `status:'rejected'`, `error: message`, `pendingGate: null`, `finishedAt: now`.
- **`complete`/`fail` gain an optional `sessionId?` 3rd arg** → spread `...(sessionId ? { sessionId } : {})` into the update set. (Existing call sites unaffected — arg is optional.)
- **`claimNext`** — inside the existing transaction, after re-selecting the claimed row, if `claimed.pendingResponse` is set, null the column in the DB (`db.update(runs).set({ pendingResponse: null })…`) but **return the row with the captured value intact** (the runner needs `pendingResponse` for `renderResponse`; the DB column is cleared so a re-claim doesn't replay it).

### Server — `packages/server/.../api/routes/runs.ts`
- **`/result` body schema** gains `gate: Type.Optional(Type.Any())` and `sessionId: Type.Optional(Type.String())`. **Before** the existing error/result branches: `if (req.body.gate) { RunRepository.pauseForGate(req.params.id, req.body.sessionId ?? '', JSON.stringify(req.body.gate)); return reply.status(200).send({ ok: true }); }`. The error branch passes `req.body.sessionId` as the 3rd arg to `fail`; the success branch passes it to `complete`. **ResultDispatcher fanout + Teams notify stay only on the `complete` (non-gate, non-error) path** — a gate is not a completion.
- **New `POST /api/runs/:id/respond`**: body `{ decision: 'approve'|'reject'|'answer', message?: string }`. 404 if run missing; **409 if `run.status !== 'waiting_approval'`**; `reject` decision → `RunRepository.reject(id, message ?? 'Rejected by user')`; else → `RunRepository.resumeWithResponse(id, JSON.stringify({ decision, message }))`. Returns `{ ok: true }`.
- The `/next` job already returns the full claimed row (now carrying `sessionId` + captured `pendingResponse`) — no change.

### Client — `apps/client/src/api/client.ts` + `lib/dashboard.ts`
- `api.runs.respond(id, { decision, message? })` → `POST /api/runs/:id/respond`.
- `Run` interface gains `sessionId?: string | null` and `pendingGate?: string | null`.
- `buildWorkerCards` (in `lib/dashboard.ts`): map `status === 'waiting_approval'` → worker state `'waiting'` (add `'waiting'` to the state union if needed; mirror the `pending → 'queued'` branch).

### Client — gate approval UI
- `apps/client/src/hooks/useRespondToRun.ts` — a react-query mutation calling `api.runs.respond`, invalidating `['runs']` on success.
- In the run-detail component (locate via grep for where a run's status/result is rendered), when `run.status === 'waiting_approval' && run.pendingGate`: parse `pendingGate`, show `summary` + `question`; **Approve**/**Reject** buttons (approve_reject), or a text input + **Send** (input/choice) → `respond({ id, decision: 'answer', message })`; **Reject** → `respond({ id, decision: 'reject', message })`.

## Data flow

Manual `ticket-to-code` run (workflow injected) → runner fresh `claude --session-id` (read-only tools) → agent emits `<gate>` + STOPs → poller `postResult{gate,sessionId}` → `/result` → `pauseForGate` (`waiting_approval`) → operator sees gate panel → `POST /respond{approve}` → `resumeWithResponse` (`pending`, `pendingResponse` set) → runner `claimNext` (captures+nulls `pendingResponse`) → `executeJob` resume branch → `runClaude --resume` with `renderResponse` user message + read-only tools → agent continues → next gate or `kind:'final'` → `/result{result,sessionId}` → `complete` + dispatch.

## Error handling

Malformed `<gate>` JSON → `extractGate` throws → poller's existing per-run try/catch → `/result{error}` → `fail` (run shows failed, not stuck). `/respond` on a non-waiting run → 409. A gate `postResult` carries no `result`, so ResultDispatcher never fires for a gate. Resume of a session whose `claude` transcript was lost (e.g. runner machine changed) → `claude --resume` errors → caught → run fails (acceptable; documented).

## Testing

- **Runner (Vitest):** `gate.test.ts` — `extractGate`: no block → null; valid → parsed; malformed → throws; missing required field → throws. (executeJob/runClaude session branching is not unit-tested — process spawn; covered by the manual smoke.)
- **Server (Jest):** `runRepository` — `pauseForGate`→waiting_approval+sessionId+pendingGate; `resumeWithResponse`→pending+pendingResponse+cleared gate; `claimNext` returns pendingResponse then nulls the column; `reject`→rejected; `complete(id,result,sessionId)` persists sessionId. `runs` route — `/result` with `gate` parks waiting_approval (+sessionId); `/respond approve` re-queues a waiting run (→pending); `/respond` on a non-waiting run → 409; `/respond reject` → rejected. (Use the existing `app.inject` + in-memory-DB patterns; the in-memory `runs` DDL already has the gate columns from Phase 1.)
- **Client (Vitest):** `dashboard` — `waiting_approval` run → worker state `'waiting'`. Gate panel component has no automated test (no testing-library) — verified by `npm run build` + manual smoke.
- **Manual smoke (controller/user, post-merge):** rebuild server+runner from dist, restart; trigger a `ticket-to-code` agent with a `workflow` set; confirm it parks at a gate (`waiting_approval`), the dashboard shows the gate panel, Approve resumes the same session, Reject marks it rejected.

## Affected files

- `packages/runner/src/executor.ts` (gate parsing, preamble, union return, session+toolArgs runClaude, Job.run fields)
- `packages/runner/src/poller.ts` (union handling, postResult body)
- `packages/runner/test/gate.test.ts` (new)
- `apps/server/src/services/RunRepository.ts` (pauseForGate/resumeWithResponse/reject; claimNext pendingResponse; complete/fail sessionId)
- `apps/server/test/runRepository.test.ts` (extend)
- `apps/server/src/api/routes/runs.ts` (`/result` gate branch + sessionId; `/respond`)
- `apps/server/test/runs.test.ts` (extend)
- `apps/client/src/api/client.ts` (respond + Run fields), `apps/client/src/lib/dashboard.ts` (+ test), `apps/client/src/hooks/useRespondToRun.ts` (new), run-detail component (gate panel)

## Deployment note

Server + runner run from `dist/` — rebuild both + restart after merge. No DB migration (columns exist). No new env, no new deps. The gated agent must have a `workflow` set (e.g. `jira-ticket-to-mr`) and be `ticket-to-code`; it runs read-only, so it proposes rather than opens MRs.
