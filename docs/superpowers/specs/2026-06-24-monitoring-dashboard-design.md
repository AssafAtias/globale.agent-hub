# Monitoring Dashboard — Design

**Date:** 2026-06-24
**Status:** Approved (design) — pending implementation plan
**Repo:** `globale.agent-hub`

## Summary

Replace the existing Run History table with a single **monitoring dashboard** at
`/runs` that answers, at a glance: what's running right now, how each agent is
doing, and the full filterable history of runs. It is built entirely on the
existing `GET /api/runs` and `GET /api/agents` endpoints (already polled every
5s) with client-side aggregation — no server changes.

## Goals

- One cohesive screen with three stacked sections: a **"now" strip**, **per-agent
  health tiles**, and a **filterable activity feed**.
- Show, for runs: when they ran, success/failure, duration, and one click to what
  each did (the existing Run Detail page).
- Show, per agent: last run, done/failed counts, success rate, and whether it's
  running right now.
- Live-ish via the existing 5s polling (no websockets).

## Non-Goals (YAGNI)

- No new server endpoint — aggregation is client-side (Approach A).
- No websockets/SSE — the runner is one-shot; 5s polling is sufficient.
- No time-window filters on stats initially (all-time counts + last-run time).
- **Nothing sub-agent-related.** Run-spawned sub-agents do not exist yet (the
  runner is a single `messages.create` call); the agentic-runner + sub-agent
  recording is a separate, later effort. This dashboard intentionally designs the
  layout so a nested-children view can be added later without rework, but builds
  none of it now.

## Approach (A — client-side aggregation)

The server already returns all runs and all agents. A pure helper module derives
the three view-models from `(runs, agents)`; the page fetches via the existing
react-query hooks and recomputes on each poll.

## Data Source (existing, unchanged)

- `GET /api/runs` → `Run[]` where `Run = { id, agentId, trigger, status, result,
  error, createdAt, finishedAt }` (client type in `api/client.ts`; note there is
  no `startedAt` on the client type — duration uses `finishedAt - createdAt`, as
  the current Run History page already does).
- `GET /api/agents` → `Agent[]` (carries identity fields: `avatarKey`, `title`,
  `skills`, …).
- Run `status` values: `pending`, `running`, `done`, `failed`.
- Hooks: `useRuns()` (react-query, `refetchInterval: 5000`) and `useAgents()`.

## Pure Logic — `apps/client/src/lib/runStats.ts` (new)

No React, no fetching — fully unit-testable. Exact signatures:

```ts
import type { Run, Agent } from '../api/client.js';

export interface AgentHealth {
  agent: Agent;
  total: number;
  done: number;
  failed: number;
  running: number;          // status pending OR running
  successRate: number | null; // done / (done + failed); null when done+failed === 0
  lastRunAt: string | null;   // max createdAt among the agent's runs
  lastStatus: string | null;  // status of the most recent run
}

export interface FeedFilter { agentId?: string; status?: string; }

// pending or running, newest-first (by createdAt desc)
export function selectActiveRuns(runs: Run[]): Run[];

// one AgentHealth per agent (in the agents array order); agents with no runs
// yield zeroed counts and null rate/lastRun
export function computeAgentHealth(runs: Run[], agents: Agent[]): AgentHealth[];

// all runs, newest-first, optionally filtered by agentId and/or status
export function filterFeed(runs: Run[], filter: FeedFilter): Run[];
```

Rules:
- Sorting by `createdAt` uses string comparison on the ISO timestamps
  (`b.createdAt.localeCompare(a.createdAt)` for desc), and operates on a **copy**
  (never mutate the react-query cache array).
- `successRate` returns `null` when there are no finished (`done`+`failed`) runs,
  so the UI can render "—" instead of `NaN`/`0%`.
- A missing/unknown `status` in a filter (empty string) means "no status filter".

## Components (all reuse existing pieces)

- **`NowStrip`** (`components/NowStrip.tsx`) — renders `selectActiveRuns` as a row
  of chips/cards: agent name (looked up from agents), `RunStatusBadge`, and
  started time. Empty state: "Nothing running right now."
- **`AgentHealthTiles`** (`components/AgentHealthTiles.tsx`) — renders
  `computeAgentHealth` as a tile per agent: `AgentAvatar` + name, last-run time
  (or "never"), `✓ {done} / ✗ {failed}`, success rate (`{rate}%` or "—"), and a
  "running now" indicator when `running > 0`. Each tile links to `/agents/:id`.
  Empty state: "No agents yet."
- **`ActivityFeed`** (`components/ActivityFeed.tsx`) — the Run History
  replacement: a table with Agent / Trigger / Status (`RunStatusBadge`) / Started
  (`toLocaleString`) / Duration (`finishedAt ? round((finishedAt-createdAt)/1000)+'s'
  : '-'`), plus two MUI `Select` filters (agent, status) bound to `filterFeed`.
  Rows are clickable → `/runs/:id`. Empty state: "No runs match."
- **`MonitoringDashboard`** (`pages/MonitoringDashboard.tsx`) — fetches
  `useRuns()` + `useAgents()`; loading spinner and error message reuse the
  existing pages' pattern; composes NowStrip → AgentHealthTiles → ActivityFeed
  top-to-bottom; owns the feed filter state.

## Routing / Navigation

- `apps/client/src/App.tsx`: route `/runs` now renders `MonitoringDashboard`
  (replacing `RunHistoryPage`); `/runs/:id` (Run Detail) unchanged; `/`,
  `/agents/*`, `/runners` unchanged.
- Delete `apps/client/src/pages/RunHistoryPage.tsx` (subsumed by the feed).
- `apps/client/src/components/Layout.tsx`: relabel the "Run History" nav item to
  **"Activity"** (same `/runs` target).

## Error / Empty Handling

- Page-level: react-query `isLoading` → `CircularProgress`; `isError` →
  "Failed to load. Is the server running?" (mirrors `AgentsPage`).
- Each section has its own empty state (above) so a partially-empty dashboard
  still reads clearly.
- `runStats` is null-safe (success rate, missing last run) so no `NaN`/blank UI.

## Testing

- **Add Vitest to the client** (`apps/client`): dev-dependency `vitest`, a `test`
  script (`vitest run`), minimal config. This is a deliberate new addition —
  the client currently has no test framework — justified because `runStats` holds
  real pure logic worth locking down.
- **`apps/client/src/lib/runStats.test.ts`** covers: `selectActiveRuns` picks only
  pending/running and sorts desc; `computeAgentHealth` counts done/failed/running,
  computes successRate, returns `null` rate for an agent with no finished runs,
  and zeroes an agent with no runs; `filterFeed` filters by agent, by status, by
  both, and returns newest-first; and that none of them mutate their inputs.
- UI components and the page: verified via `npx tsc --noEmit` + manual smoke
  (consistent with the identity-layer work). Root `npm test` (server Jest) is
  unaffected; the client gains its own `vitest` test script.

## Affected / New Files

**New**
- `apps/client/src/lib/runStats.ts`
- `apps/client/src/lib/runStats.test.ts`
- `apps/client/src/components/NowStrip.tsx`
- `apps/client/src/components/AgentHealthTiles.tsx`
- `apps/client/src/components/ActivityFeed.tsx`
- `apps/client/src/pages/MonitoringDashboard.tsx`
- `apps/client/vitest.config.ts` (or `test` field) + `vitest` devDependency

**Modified**
- `apps/client/src/App.tsx` (route `/runs` → MonitoringDashboard; drop RunHistoryPage import)
- `apps/client/src/components/Layout.tsx` (nav label "Run History" → "Activity")

**Deleted**
- `apps/client/src/pages/RunHistoryPage.tsx`

## Forward-Compatibility Note

The activity feed and run rows are structured so that, when run-spawned
sub-agents land later (the separate Piece A), child runs can be rendered nested
under their parent row without restructuring the dashboard — but no sub-agent
code, data, or UI is part of this design.

## Open Questions

None blocking.
