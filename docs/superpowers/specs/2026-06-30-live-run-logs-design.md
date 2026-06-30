# Live Run Logs in Run Detail — Design

**Date:** 2026-06-30
**Repo:** `globale.agent-hub`
**Status:** Approved (spec review passed)
**Roadmap:** Phase 5D (observability). A first attempt was made + reverted during Phase 4B (scope creep — `87cb18b`, dangling, recoverable for reference only); this is the proper, designed, tested version.

## Problem

During an agent run there is **no visibility into what's happening**. The runner executes `claude -p … --output-format json` to completion in one shot and posts only the final `result`/`error`/`gate`/`handoff`. Run Detail shows a bare spinner while `running`; runner activity is `console.log` to the terminal only, never persisted or surfaced. Operators can't see tool use, progress, or where a run is stuck.

## Goal

Show a **live activity timeline** in Run Detail: as the agent runs, per-step events (tool use, assistant steps) stream to the UI. In-memory, live-oriented; polled. The final result still flows exactly as today.

## Non-goals (YAGNI)

- No SSE (polling). No persisted event history (in-memory, bounded). No log download/search. No token-level streaming of assistant text (event granularity). No DB migration, no new deps.

## Decisions

| Question | Decision |
|---|---|
| Event source | Switch `runClaude` to `--output-format stream-json --verbose` (only way to get per-step events) |
| Storage | **In-memory bounded** `RunEventStore` (per-run cap ~200, LRU ~50 runs); lost on restart |
| Transport | **Polling** — `GET /api/runs/:id/events`, react-query `refetchInterval` while active |
| Safety valve | **`RUN_EVENTS_ENABLED` (default true)** — false reverts to today's `json` one-shot, no events |

## ⚠️ Central safety requirement — result-contract equivalence

`extractGate` / `extractHandoff` / `extractMemoryUpdate` all parse the **final result string** `runClaude` returns. Today that string comes from `JSON.parse(stdout)` of json mode's single `{ subtype, is_error, result }` object. In stream-json mode, the stream ends with a terminal **`{type:'result', subtype, is_error, result, …}`** event (same fields). The reconstructed return value MUST be byte-identical:

- Find the terminal `type:'result'` event in the stream; treat it exactly as json mode treated its single object: if `is_error || (subtype && subtype !== 'success')` → throw the same error; else return `(result ?? '').trim() || '(no output)'`.
- If the stream produces **no** `result` event (CLI died mid-stream) → throw (same as a json-mode non-zero exit / non-JSON output).
- This equivalence is the #1 requirement and gets a dedicated unit test against a captured stream-json transcript. Gate/handoff/memory behavior must be unchanged.

## Components

### Runner — `packages/runner/src/executor.ts`
- `export interface ProgressEvent { kind: string; label: string; detail?: string }` and `type OnProgress = (e: ProgressEvent) => void`.
- `export function summarizeStreamEvent(evt: unknown): ProgressEvent[]` — pure mapper from a parsed stream-json line to zero+ readable events:
  - `type:'system', subtype:'init'` → `[{kind:'system', label:'session started'}]` (or `[]`).
  - `type:'assistant'` with `message.content[]`: for each `{type:'text'}` block → `{kind:'assistant', label:'responding', detail:<first ~120 chars>}`; for each `{type:'tool_use', name, input}` → `{kind:'tool', label:name, detail:<short input summary, e.g. file_path / command / pattern>}`.
  - `type:'user'` tool_result → `[]` (or a terse `{kind:'tool_result', label:'result'}`) — keep minimal.
  - `type:'result'` → `[]` (terminal; handled by the result extractor, not shown as progress).
  - Unknown/garbage → `[]`. Pure + unit-tested. (Starting point: the reverted `87cb18b` `summarizeStreamEvent` — re-reviewed, not copied blind.)
- `export function extractStreamResult(lines: string[]): string` (or throw) — pure: scan parsed lines for the terminal `type:'result'` event, apply the contract above, return the result string or throw. (Returns a bare `string`, matching `runClaude`'s return — no wrapper.) Unit-tested (the safety test).
- `runClaude(model, systemPrompt, userMessage, cwd, toolArgs, opts: { sessionId; resume; streaming: boolean; onProgress?: OnProgress })`:
  - When `!opts.streaming`: **unchanged** json path (current code) — kill-switch fallback.
  - When `opts.streaming`: spawn args use `--output-format stream-json --verbose` (instead of `json`); read stdout through a **line buffer** (accumulate chunks, split on `\n`, keep the remainder); for each complete line: `JSON.parse` (skip on failure), push the parsed event to a list, and `summarizeStreamEvent(evt).forEach(opts.onProgress)`. **On stream `close`, flush any non-empty remainder as a final line attempt** (parse + push) — handles a stream that ends without a trailing newline (e.g. the `result` event is the last partial line). Then pass the collected parsed events to `extractStreamResult` → return its string (or propagate its throw). Everything else (env strip, `shell:true`, 10-min timeout) unchanged.
  - **The `try/finally` that writes (guarded by `!resume`) and unlinks `sysFile` MUST wrap the ENTIRE streaming execution path** (the spawn + the async line-reading promise), exactly as it wraps the json path today — so a sysFile is never leaked on a streaming error. Do not place the streaming branch outside the existing `try/finally`.
- `executeJob` — exact new signature (positional, appended): `executeJob(job, localReposRoot, skillsDir, workflowsDir, memory, toolsEnabled, runEventsEnabled, onProgress?)`. It passes `{ streaming: runEventsEnabled, onProgress }` (plus the existing `sessionId`/`resume`) into `runClaude`'s opts.

### Runner — `packages/runner/src/poller.ts` + `config.ts`
- `config.ts`: add `runEventsEnabled: boolean` mirroring the `toolsEnabled` pattern exactly — `runEventsEnabled: !['false','0','no'].includes((process.env.RUN_EVENTS_ENABLED ?? '').trim().toLowerCase())` (default true; empty/unset → true). Pass `config.runEventsEnabled` to `executeJob`.
- `poller.ts`: inside the per-job `try` block, declare `let seq = 0;` (per-run counter, reset each claimed job) and build `const onProgress = (e) => { postEvent(config, job.run.id, { seq: seq++, ...e }).catch(() => {}); };` — **fire-and-forget** (the `.catch(()=>{})` ensures a failed/slow `postEvent` never blocks or fails the run). Pass `onProgress` + `config.runEventsEnabled` to `executeJob`. `postEvent` = a helper doing `POST /api/runs/:id/events` with the `x-runner-token` header.

### Server — `apps/server/src/services/RunEventStore.ts` (new, in-memory)
- `interface RunEvent { seq: number; kind: string; label: string; detail?: string }`.
- `append(runId, evt)`: push to the run's array; trim to last `MAX_PER_RUN` (200); on a NEW runId, evict the oldest run if tracking > `MAX_RUNS` (50) — simple insertion-order LRU: a JS `Map` preserves insertion order, so `map.keys().next().value` is the oldest key to `delete`.
- `list(runId): RunEvent[]` (empty array if unknown). Module-level singleton.

### Server — `apps/server/src/api/routes/runs.ts`
- `POST /api/runs/:id/events` — headers `Type.Object({ 'x-runner-token': Type.String() })` (validate the token like `/result`/`/next` → 401 on mismatch); body schema `Type.Object({ seq: Type.Number(), kind: Type.String(), label: Type.String(), detail: Type.Optional(Type.String()) })`; `RunEventStore.append(id, body)`; return `{ ok: true }`.
- `GET /api/runs/:id/events` — return `RunEventStore.list(id)` (array). **No auth — a deliberate choice, consistent with `GET /api/runs`** (events may include tool names / file paths; acceptable for this local single-user tool; documented here so it isn't later flagged as an oversight).

### Client — `apps/client`
- `api.runs.events(id)` → `GET /api/runs/:id/events` returning `RunEvent[]` (add the type).
- `apps/client/src/hooks/useRunEvents.ts` — `useQuery({ queryKey:['runEvents', id], queryFn:()=>api.runs.events(id), refetchInterval: isTerminal ? false : 2000 })` where `isTerminal = status === 'done' || status === 'failed'` (mirror the existing `useRun` stop-condition so the two never diverge / future statuses keep polling). Caller passes the run status.
- `RunDetailPage`: render a **timeline** — a list of events (`kind` chip · `label` · `detail`), most-recent last, shown while running and after. Keep the spinner as a header accent; the timeline replaces the "nothing to see" gap.

## Data flow
runner spawns `claude --output-format stream-json --verbose` → each stdout line parsed → `summarizeStreamEvent` → `onProgress` → fire-and-forget `POST /api/runs/:id/events` → `RunEventStore` → Run Detail polls `GET …/events` every 2s → timeline. Terminal `result` event → `extractStreamResult` → returned as the final result → `/result` (unchanged downstream).

## Error handling / safety
`RUN_EVENTS_ENABLED=false` → exact current json one-shot, zero events. Event POSTs are best-effort (failure never touches the run). Unparseable stream lines skipped. No `result` event → throw (run fails cleanly, as today). Store bounded (per-run + LRU). The result-contract equivalence test guards gate/handoff/memory.

## Testing

- **Step 0 (MANDATORY, before implementing the parsers) — capture a REAL transcript.** Run one real `claude -p --output-format stream-json --verbose` with a trivial prompt AND the same prompt with `--output-format json`. Confirm: (a) `--verbose` is accepted alongside `-p` (the spawn succeeds); (b) the stream's terminal `type:'result'` event's `.result`/`.is_error`/`.subtype` fields exist and `.result` **equals** the json-mode output's `.result` for the same input; (c) note the actual `assistant`/`tool_use` event field names. **Check the captured stream-json transcript into the repo as the test fixture** (e.g. `packages/runner/test/fixtures/stream-json-sample.jsonl`). The safety + summarize tests run against THIS real fixture, not a hand-mocked one — otherwise they give false assurance. This is the one place we spend a real `claude` invocation (cheap, trivial prompt). If (b) fails (the result strings differ), STOP and revisit the design before building.
- **Runner (Vitest):** `extractStreamResult` — the **safety test** (against the Step 0 fixture): feed a captured stream-json transcript (system+assistant+tool_use+tool_result+result lines) → assert the returned `result` equals the `result` event's `.result`; an `is_error:true` / non-success `subtype` result event → throws; no result event → throws. `summarizeStreamEvent` — assistant text → 1 event; tool_use → tool event w/ name+detail; result/unknown → []. Line-buffer split (a line split across chunks reassembles) if extracted as a helper.
- **Server (Jest):** `RunEventStore` append/list, per-run cap (201st drops the 1st), LRU run eviction. `/events` POST appends + token auth (401 bad token); GET returns the array.
- **Client (Vitest):** `useRunEvents` polls while active, stops when terminal (the refetchInterval gate). Timeline render → build-verify.
- **Live verify (end):** run a real agent via `start-agent-hub.ps1`; watch Run Detail populate tool-use/assistant events in real time; flip `RUN_EVENTS_ENABLED=false` → confirm runs still complete with no events (fallback intact).

## Affected files
- `packages/runner/src/executor.ts` (ProgressEvent, summarizeStreamEvent, extractStreamResult, runClaude streaming branch, executeJob params)
- `packages/runner/src/poller.ts` (onProgress→postEvent), `packages/runner/src/config.ts` (runEventsEnabled)
- `apps/server/src/services/RunEventStore.ts` (new)
- `apps/server/src/api/routes/runs.ts` (POST+GET /events)
- `apps/client/src/api/client.ts` (events api + RunEvent type), `apps/client/src/hooks/useRunEvents.ts` (new), `apps/client/src/pages/RunDetailPage.tsx` (timeline)
- tests as listed (+ `packages/runner/test/fixtures/stream-json-sample.jsonl` captured in Step 0)

## Deployment note
Server + runner run from `dist/` — rebuild both + restart after merge (this changes the runner's core spawn). New optional env `RUN_EVENTS_ENABLED` (default true); add to `.env.example`. No DB migration, no new deps. Streaming is on by default; set `RUN_EVENTS_ENABLED=false` to revert to the json one-shot.
