# Scheduled (cron) Triggers — Design

**Date:** 2026-06-30
**Repo:** `globale.agent-hub`
**Status:** Approved (spec review passed)
**Roadmap:** Phase 2B (see memory `agent-hub-roadmap`)

## Problem

Agents only run reactively (webhook / manual). There is no way to run an agent on a schedule — e.g. a nightly flaky-test scan, a stale-PR nudge, or a weekly report. Phase 1A made this viable: a proactive agent can now use read-only repo tools to gather its own context, so a scheduled run needs no triggering payload.

## Goal

Let an enabled agent fire on a cron schedule. A server-side scheduler creates a `trigger:'schedule'` run on cadence; the runner executes it like any other run. The cron expression is configured per agent in the existing agent-config UI. Scheduled runs carry a small default context (a preamble + the agent's repo list); the runner's `LocalEnricher` adds the repo `CLAUDE.md` on top as it already does for every run.

## Non-goals (YAGNI)

- No per-agent timezone (croner uses the host/local TZ).
- No missed-slot backfill beyond a single catch-up fire.
- No UI preset dropdown (free-text cron field).
- No per-run schedule-history view (runs already display their `trigger`).
- No DB migration (cron rides in the existing `triggerRules` JSON; dedup derived from the `runs` table).

## Decisions

| Question | Decision |
|---|---|
| Schedule format | **Cron expressions** via the `croner` dependency |
| Where stored | Per-agent **`triggerRules.cron`** (JSON; no migration) |
| Config surface | Server-side + a **`Schedule (cron)` field** in the client `TriggerRulesForm` |
| Scheduled-run context | **Default context** = preamble + repo list (`buildScheduledContext`); CLAUDE.md added by the runner's existing `LocalEnricher` |

## Components

### Dependency
Add `croner` (`^9.0.0`) to `apps/server/package.json` dependencies. Import as `import { Cron } from 'croner';`. Construct with **no callback** (`new Cron(expr)` only) so it does not auto-schedule a live job — used purely for calculation.

**IMPLEMENTATION REALITY (croner 9.1.0):** the installed version has **no `previousRuns`** (the docs were ahead of the shipped version), and `previousRun(date)` returns `undefined`. So `isDue` is built on **`nextRun(date)`** instead, which natively handles non-uniform schedules (e.g. weekday-only). Deriving a "previous slot" by assuming a constant interval is WRONG for non-uniform crons (a weekday-2am schedule would mis-fire on weekends) — do NOT do that.

### Pure helpers — `apps/server/src/services/schedule.ts`
```ts
export function isDue(cronExpr: string, lastScheduledAtIso: string | null, now: Date): boolean
export function parseCronFromTriggerRules(triggerRulesJson: string): string | null
export function buildScheduledContext(reposJson: string): string
```
- **`isDue`** (nextRun-based): `const cron = new Cron(cronExpr)`. If `lastScheduledAtIso === null` → return `cron.nextRun(now) !== null` (never fired → fire once on the next tick for any valid recurring schedule). Else `const next = cron.nextRun(new Date(lastScheduledAtIso))`; return `next !== null && next.getTime() <= now.getTime()` (a slot fell in `(lastScheduled, now]`). Whole body in try/catch → invalid expression returns `false`.
- **`parseCronFromTriggerRules`**: JSON-parse the agent's `triggerRules`; return a non-empty trimmed `cron` string or `null` (safe-parse → null on garbage).
- **`buildScheduledContext`**: parse `reposJson` (string[]); return `JSON.stringify(ctx)` where `ctx` always has `'Scheduled run': 'This is a scheduled (cron) run with no triggering event. Use your available tools to inspect the repo(s) and carry out your task.'`, and — only when repos is a non-empty array — `'Repos': repos.join(', ')`. (Shape matches the runner's `formatContext`: a flat object of key→string.)

### `RunRepository.lastScheduledRun(agentId)` — `apps/server/src/services/RunRepository.ts`
Returns the most recent `runs` row with `trigger = 'schedule'` for the agent, or `null`. **Add `desc` to the `drizzle-orm` import** (the file currently imports `{ eq, and }` only). Exact query:
```ts
getDb().select().from(runs)
  .where(and(eq(runs.agentId, agentId), eq(runs.trigger, 'schedule')))
  .orderBy(desc(runs.createdAt)).limit(1).get() ?? null
```
Used for slot dedup; DB-backed so it survives restarts.

### Scheduler shell — `apps/server/src/services/Scheduler.ts`
```ts
export function runDueAgents(now: Date): void   // exported for testing
export function startScheduler(intervalMs?: number): () => void  // returns a stop fn
```
- `runDueAgents(now)`: iterate `AgentRepository.findAll()` — note this **already excludes archived agents** (its `includeArchived` option defaults false), so only filter on `agent.enabled` (no `!archived` check needed). For each enabled agent, `const cron = parseCronFromTriggerRules(agent.triggerRules)`; if `!cron` skip; `const last = RunRepository.lastScheduledRun(agent.id)?.createdAt ?? null`; if `isDue(cron, last, now)` → `RunRepository.create({ agentId: agent.id, trigger: 'schedule', triggerPayload: '{}', context: buildScheduledContext(agent.repos) })`. Each agent wrapped in try/catch (a bad agent never aborts the loop).
- `startScheduler(intervalMs = 60_000)`: define `tick = () => { try { runDueAgents(new Date()) } catch (e) { console.error('[Scheduler] tick failed:', e) } }`; run `tick()` once immediately; `const h = setInterval(tick, intervalMs)`; return `() => clearInterval(h)`.

### Wiring — `apps/server/src/index.ts`
Inside the existing `app.listen(..., (err) => { ... })` callback, place `startScheduler()` **after the `if (err) { … process.exit(1) }` block** (so it runs only on successful bind, not before the error check and not after the unreachable `process.exit`). Import `{ startScheduler }` from `./services/Scheduler.js`.

### Client — `apps/client/src/components/TriggerRulesForm.tsx`
- Extend the local `TriggerRules` interface with `cron?: string`.
- Add a `TextField` `label="Schedule (cron, optional)"`, `placeholder="0 2 * * 1-5"`, bound to `value.cron`, `onChange` → `onChange({ ...value, cron: e.target.value || undefined })`. Same controlled pattern as `branchFilter`/`jiraLabel`. It serializes into the agent's `triggerRules` JSON on save (no api/type change beyond the interface).

## Data flow

Server tick (every 60s) → `runDueAgents(now)` → due agents → `RunRepository.create(trigger:'schedule', context:buildScheduledContext(repos))` → runner long-poll claims it → `LocalEnricher` adds repo `CLAUDE.md` → agent runs its prompt with 1A read-only tools → result to the agent's outputs (dashboard always; +teams_webhook etc. if configured).

## Error handling

Invalid/empty cron → agent skipped (no crash). A throw handling one agent is caught; the tick continues. A missed slot (server down) fires exactly one catch-up on the next tick (because `lastScheduledRun.createdAt < prev`), not a burst. Two ticks within one slot create no duplicate (dedup via `lastScheduledRun`).

## Testing (Jest)

- **`test/schedule.test.ts`** — `isDue` (hourly/every-minute exprs + fixed `now` Dates for determinism): never-fired → true; last-fire after the current slot → false; last-fire before the current slot → true; invalid cron → false. `parseCronFromTriggerRules`: extracts cron, null on missing/empty/garbage. `buildScheduledContext`: always includes the preamble key; includes `Repos` for a non-empty array; omits `Repos` for empty/garbage repos JSON; output is valid JSON.
- **`test/runRepository.test.ts`** (new, camelCase per project style) — `lastScheduledRun` in-memory DB: returns the latest `schedule`-trigger run; ignores `webhook`/`manual` runs; null when none.
- **`test/scheduler.test.ts`** — in-memory DB seeded with: a due enabled cron agent, a no-cron agent, a disabled cron agent, an archived cron agent. `runDueAgents(now)` creates exactly one `schedule` run (for the due enabled agent); a second immediate `runDueAgents(now)` creates no duplicate (dedup is reliable because `RunRepository.create` + the whole tick are synchronous on better-sqlite3 — no overlap possible in this single-process server). (Use the same in-memory-DB setup pattern as `runs.test.ts`.)
- Client: the `cron` field renders and round-trips through `onChange` (type-level + `npm run build`; the client has no testing-library).

## Affected files

- `apps/server/package.json` (add `croner`)
- `apps/server/src/services/schedule.ts` (new — 3 pure helpers)
- `apps/server/src/services/Scheduler.ts` (new — tick shell)
- `apps/server/src/services/RunRepository.ts` (modify — `lastScheduledRun`)
- `apps/server/src/index.ts` (modify — start scheduler)
- `apps/client/src/components/TriggerRulesForm.tsx` (modify — cron field + type)
- tests as listed

## Deployment note

Server runs from `dist/` — `npm install` (for croner) + `npx tsc` in `apps/server` + restart after merge. The scheduler starts automatically; agents without a `triggerRules.cron` are unaffected. No env var, no DB migration. To use: set an agent's Schedule (cron) field (e.g. `0 2 * * 1-5`), ensure it's enabled, and the runner is up. Croner uses the host timezone.
