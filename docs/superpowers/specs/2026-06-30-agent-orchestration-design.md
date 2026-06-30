# Agent Orchestration (dynamic handoff) — Design

**Date:** 2026-06-30
**Repo:** `globale.agent-hub`
**Status:** Approved (pending spec review)
**Roadmap:** Phase 4B.

## Problem

Agents are isolated: a reviewer that finds issues can't route them to a fixer. There is no way for one agent to trigger another. Phase 4A added a `<gate>` extraction pattern and the run union; this builds on it so an agent can hand work to a teammate agent.

## Goal

An agent can end a run with `<handoff>{"agent":"<slug>","message":"…"}</handoff>`. The source run **completes normally** (result stored + dispatched) **and** spawns a child run of the target agent with the message as context — bounded by a depth cap and a cycle guard. Read-only (the target agent *proposes*, like 4A — no write tools).

## Non-goals (YAGNI)

- No write/git tools (the "fixer" proposes; same constraint as 4A).
- No parallel fan-out (one handoff per run; the last/first `<handoff>` block only).
- No `parent_run_id` column / chain-graph view — lineage lives in `triggerPayload`; the UI shows a one-line "spawned by".
- No cross-run cancellation, no handoff for error/gate outcomes (only on a clean completion).
- No DB migration, no new deps.

## Decisions

| Question | Decision |
|---|---|
| Handoff model | **Dynamic** — agent emits `<handoff>` block at runtime (conditional; reuses 4A extraction) |
| Loop safety | **Depth cap (MAX=3) + cycle guard**; chain metadata in `triggerPayload` (no migration) |
| Protocol preamble | **Injected into every run** (short; agent acts only if its prompt instructs) |
| Target resolution | `AgentRepository.findBySlug` (+ `slugify`) — already exist from the Teams work |

## Components

### Runner — `packages/runner/src/executor.ts`
- **`HandoffPayload`** type: `{ agent: string; message: string }`.
- **`extractHandoff(text): { result: string; handoff: HandoffPayload | null }`** — match `<handoff>([\s\S]*?)</handoff>`; none → `{ result: text, handoff: null }`; parse JSON (throw on malformed); require `agent` + `message` (throw if missing); return the text with the block stripped (mirrors `extractMemoryUpdate`).
- **`HANDOFF_PROTOCOL`** const (short, always pushed into the system-prompt `parts`, e.g. right after `GATE_PROTOCOL`/before the agent prompt): explains that to delegate to another agent the turn must end with exactly one `<handoff>{"agent":"<slug>","message":"…"}</handoff>` block, that this is optional and only used when the agent's task says so, and that `message` should fully brief the other agent (it gets only that message as context).
- **`executeJob` precedence:** gate first (pause — unchanged). Otherwise extract handoff THEN memory from `raw`:
  ```ts
  const { result: afterHandoff, handoff } = extractHandoff(raw);
  const { result, note } = extractMemoryUpdate(afterHandoff);
  return { kind: 'final' as const, result, note, sessionId, handoff };
  ```
  The `kind:'final'` union member gains `handoff?: HandoffPayload | null`.

### Runner — `packages/runner/src/poller.ts`
- On `kind:'final'`, include `handoff` in the `postResult` body: `{ result: outcome.result, sessionId: outcome.sessionId, handoff: outcome.handoff }`. Widen `postResult`'s body type with `handoff?: unknown`.

### Server — `apps/server/src/services/handoff.ts` (new, pure helpers)
```ts
export const MAX_HANDOFF_DEPTH = 3;

// reads triggerPayload.handoff; top-level run → { depth: 0, chainAgentIds: [] }
export function parseParentChain(parentTriggerPayload: string): { depth: number; chainAgentIds: string[] }

// pure decision + child-payload/context builder (no I/O)
export function planHandoff(
  parent: { id: string; agentId: string; triggerPayload: string },
  targetAgentId: string,
  message: string,
): { spawn: true; childTriggerPayload: string; context: string } | { spawn: false; reason: string }
```
- `parseParentChain`: safe-parse the JSON; return `triggerPayload.handoff.{depth,chainAgentIds}` if present and well-formed, else `{depth:0, chainAgentIds:[]}`.
- `planHandoff`: `const { depth, chainAgentIds } = parseParentChain(parent.triggerPayload)`. **Refuse** (`{spawn:false, reason}`) when `depth >= MAX_HANDOFF_DEPTH` (the child would exceed the cap) OR `targetAgentId === parent.agentId` OR `chainAgentIds.includes(targetAgentId)` (cycle). Else `{ spawn: true, childTriggerPayload: JSON.stringify({ handoff: { fromRunId: parent.id, fromAgentId: parent.agentId, depth: depth + 1, chainAgentIds: [...chainAgentIds, parent.agentId] } }), context: JSON.stringify({ 'Handoff request': message }) }`.

### Server — `apps/server/src/api/routes/runs.ts`
- In the `/result` **success (complete) branch**, AFTER the existing `complete(...)` + ResultDispatcher fan-out, add (only when `req.body.handoff` present):
  ```ts
  if (req.body.handoff?.agent && completedRun) {
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
  }
  ```
  Widen the `/result` body schema with `handoff: Type.Optional(Type.Any())`. The gate branch (returns early) and error branch are unchanged — a handoff only fires on a clean completion. (`completedRun` is the row already re-fetched in the success branch.)

### Client — `apps/client`
- `/result` and the `Run` shape don't change. In the run list and/or `RunDetailPage`, for a run whose `triggerPayload` parses to `{ handoff: {...} }`, render a small caption: `↳ spawned by handoff (depth N)` (parse `triggerPayload`; resolve `fromAgentId` to a name via the loaded agents list if convenient, else show the id). Minimal, additive; guarded `JSON.parse`.

## Data flow
Reviewer completes with `<handoff>{agent:"fixer",message:"…"}>` → poller `postResult{result, handoff}` → `/result` completes the reviewer (result + dispatch) → resolve `fixer` slug → `planHandoff` (depth<3, not in chain) → create `trigger:'handoff'` fixer run (context = the message; chain metadata in payload) → runner claims + runs the fixer read-only → the fixer may itself hand off, until depth 3 or a cycle is refused.

## Error handling
Malformed `<handoff>` → `extractHandoff` throws → poller per-run catch → `/result{error}` → `fail` (not stuck). Unknown target slug → logged, no spawn. Depth/cycle refusal → logged, no spawn; the parent still completed. All bounded; chain metadata in `triggerPayload` (no migration).

## Testing
- **Runner (Vitest) `test/handoff.test.ts`** — `extractHandoff`: none → `{result:text, handoff:null}`; valid → parsed + block stripped from result; malformed JSON → throws; missing `agent`/`message` → throws.
- **Server (Jest) `test/handoff.test.ts`** — `parseParentChain` (absent → depth0/[]; present → values; garbage → depth0/[]); `planHandoff` (happy → depth+1 & chain extended & context has the message; refuse at `depth=3`; refuse on self-handoff; refuse when target in chain).
- **Server (Jest) `test/runs.test.ts`** (extend) — `/result` with a `handoff` to a real agent completes the parent AND creates a `trigger:'handoff'` child run; unknown slug → parent completes, no child; a depth-3 parent payload → no child. Reuse `app.inject` + register-runner + claim flow.
- **Client** — lineage caption renders for a handoff run (if testable; else `npm run build`).

## Affected files
- `packages/runner/src/executor.ts` (extractHandoff, HANDOFF_PROTOCOL, executeJob handoff in union), `packages/runner/src/poller.ts` (postResult handoff)
- `packages/runner/test/handoff.test.ts` (new)
- `apps/server/src/services/handoff.ts` (new), `apps/server/test/handoff.test.ts` (new)
- `apps/server/src/api/routes/runs.ts` (/result handoff spawn), `apps/server/test/runs.test.ts` (extend)
- `apps/client` run list/detail (lineage caption)

## Deployment note
Server + runner run from `dist/` — rebuild both + restart after merge. No DB migration, no new env, no new deps. To use: give a reviewer agent a prompt that says, when it finds issues, to end with `<handoff>{"agent":"<fixer-slug>","message":"…"}</handoff>`; ensure a fixer agent exists whose `slugify(name)` matches. Both run read-only (propose, not write). Max chain depth 3.
