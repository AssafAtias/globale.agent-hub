# Activity Archive — Design

**Date:** 2026-06-24
**Status:** Approved (design)
**Scope:** Sub-project A of a larger agent-hub effort (skills, agent memory bank, and a self-healing retry loop are separate, later sub-projects).

## Problem

The monitoring dashboard's Activity feed ([MonitoringDashboard.tsx](../../../apps/client/src/pages/MonitoringDashboard.tsx) → [ActivityFeed.tsx](../../../apps/client/src/components/ActivityFeed.tsx)) shows every run forever. There is no way to clean it up. As runs accumulate, the feed, the "now" strip, and the agent health tiles get noisy and old/irrelevant runs cannot be cleared out of view.

## Goal

Let the user **archive** individual runs to remove them from the monitoring view, with the ability to reveal and restore them. Archiving is a **soft** operation — nothing is deleted.

## Behavior

- Each run gets an `archived` flag, default `false`.
- Archived runs are **excluded by default** from the monitoring view: the Activity feed, the `NowStrip` active runs, and the `AgentHealthTiles` stats. Archiving means "remove this from my dashboard."
- A **"Show archived"** toggle in the Activity feed reveals archived rows, rendered visually muted, each with an **Unarchive** action.
- Non-archived rows show an **Archive** action.
- Archiving/unarchiving is per-row only.

## Architecture

Follows existing repo patterns: server keeps returning all runs from `GET /api/runs`; filtering/derivation stays client-side (consistent with how the dashboard already computes active runs, health, and the filtered feed).

### 1. DB / schema

[apps/server/src/db/schema.ts](../../../apps/server/src/db/schema.ts)

- Add to the `runs` table:
  ```ts
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ```
- New drizzle migration `0002_*.sql`:
  ```sql
  ALTER TABLE `runs` ADD `archived` integer DEFAULT false NOT NULL;
  ```
- **There is no runtime migrator** in this repo (no `migrate()` call at startup — verified). The migration SQL is applied manually with drizzle-kit against the existing dev databases. Note there are two DB files to update: the repo-root `agent-hub.db` and `apps/server/agent-hub.db`. The implementation must apply the `ALTER TABLE` to whichever DB the server actually opens (default `./agent-hub.db` relative to the server cwd).

### 2. Server

[apps/server/src/services/RunRepository.ts](../../../apps/server/src/services/RunRepository.ts)

- Add `setArchived(id: string, archived: boolean)`: updates the `archived` column for the run; returns the updated row or `null` if not found.
- `findAll` is unchanged — it returns all runs including the new `archived` field.

[apps/server/src/api/routes/runs.ts](../../../apps/server/src/api/routes/runs.ts)

- Add `PATCH /api/runs/:id`:
  - params: `{ id: string }`
  - body (TypeBox): `{ archived: boolean }`
  - On success: call `RunRepository.setArchived`, return the updated run (200).
  - If the run does not exist: 404.

### 3. Client

[apps/client/src/api/client.ts](../../../apps/client/src/api/client.ts)

- Add `archived: boolean` to the `Run` interface.
- Add `api.runs.setArchived(id: string, archived: boolean)` → `PATCH /api/runs/:id`.

[apps/client/src/lib/runStats.ts](../../../apps/client/src/lib/runStats.ts)

- `selectActiveRuns`: exclude `archived` runs.
- `computeAgentHealth`: exclude `archived` runs from all counts/stats.
- `FeedFilter`: add `showArchived?: boolean`.
- `filterFeed`: when `showArchived` is falsy, drop archived runs; when true, include them.

[apps/client/src/components/ActivityFeed.tsx](../../../apps/client/src/components/ActivityFeed.tsx)

- Add a **"Show archived"** `Switch` to the filter row, bound to `filter.showArchived`.
- Add an actions column with an Archive/Unarchive `IconButton` per row. The button calls a react-query `useMutation` wrapping `api.runs.setArchived`, invalidating the `['runs']` query on success. The button's `onClick` must `stopPropagation` so it doesn't trigger the row's navigate-to-detail click.
- Archived rows are rendered muted (e.g. `sx={{ opacity: 0.55 }}`).

### 4. Tests

- [apps/client/src/lib/runStats.test.ts](../../../apps/client/src/lib/runStats.test.ts) (vitest, already configured): archived runs are excluded from `selectActiveRuns` and `computeAgentHealth`; `filterFeed` includes/excludes archived based on `showArchived`.
- Server jest test (alongside [apps/server/test/runs.test.ts](../../../apps/server/test/runs.test.ts)): `PATCH /api/runs/:id` archives and unarchives a run; returns 404 for an unknown id.

## Non-goals

- No bulk archive ("archive all matching filter").
- No "older-than" cleanup action.
- No hard delete / permanent purge.
- No auth or permissions changes.
- No separate "Archived" page (the in-feed toggle covers it).

These can be added later as follow-ups if needed.

## Risks

- **Existing dev DBs** must have the `ALTER TABLE` applied or the server will error on the missing column. Mitigation: apply the migration to both `.db` files during implementation and document the manual step.
- **Health-tile semantics change:** excluding archived runs from health stats means archiving a failed run improves an agent's success rate. This is intended ("clean up my view"), but worth noting.

## Open questions

None outstanding — behavior confirmed during brainstorming (soft archive, per-row only, show-archived toggle).
