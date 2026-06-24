# Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Run History page with a monitoring dashboard at `/runs` showing a live "now" strip, per-agent health tiles, and a filterable activity feed.

**Architecture:** Client-only. A pure, unit-tested `runStats` module derives three view-models from the existing `useRuns()` + `useAgents()` data; three presentational components render them; one page composes them. No server changes.

**Tech Stack:** React 18 + MUI 7 + `@tanstack/react-query` + `react-router-dom` 6 + Vite; Vitest (added in Task 1) for the pure logic.

## Global Constraints

- Client is ESM with **`.js` import specifiers** on all relative imports (e.g. `'../api/client.js'`), per the existing codebase.
- **No server changes; no new endpoints; no websockets.** Data comes from existing `useRuns()` (react-query, `refetchInterval: 5000`) and `useAgents()`.
- `Run` shape (from `apps/client/src/api/client.ts`): `{ id, agentId, trigger, status, result, error, createdAt, finishedAt }` — **no `startedAt`**; duration = `finishedAt - createdAt`.
- Run `status` values: `pending`, `running`, `done`, `failed`.
- Aggregation must operate on **copies** — never mutate the react-query cache arrays (no in-place `.sort()` on a hook's returned array).
- `successRate` is `null` when `done + failed === 0` (UI renders "—", never `NaN`).
- **Nothing sub-agent-related** is in scope.

---

## File Structure

**New**
- `apps/client/src/lib/runStats.ts` — pure aggregation (active runs, per-agent health, feed filter).
- `apps/client/src/lib/runStats.test.ts` — Vitest unit tests for the above.
- `apps/client/src/components/NowStrip.tsx` — in-progress runs row.
- `apps/client/src/components/AgentHealthTiles.tsx` — per-agent health tiles.
- `apps/client/src/components/ActivityFeed.tsx` — filterable run table (Run History replacement).
- `apps/client/src/pages/MonitoringDashboard.tsx` — composes the three sections.

**Modified**
- `apps/client/vite.config.ts` — add Vitest `test` block.
- `apps/client/package.json` — add `vitest` devDependency + `test` script.
- `apps/client/src/App.tsx` — route `/runs` → `MonitoringDashboard`; drop `RunHistoryPage` import.
- `apps/client/src/components/Layout.tsx` — nav label `'Run History'` → `'Activity'`.

**Deleted**
- `apps/client/src/pages/RunHistoryPage.tsx`.

---

### Task 1: Vitest setup + `runStats` pure module

**Files:**
- Modify: `apps/client/package.json`
- Modify: `apps/client/vite.config.ts`
- Create: `apps/client/src/lib/runStats.ts`
- Test: `apps/client/src/lib/runStats.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2–5):
  - `interface AgentHealth { agent: Agent; total: number; done: number; failed: number; running: number; successRate: number | null; lastRunAt: string | null; lastStatus: string | null; }`
  - `interface FeedFilter { agentId?: string; status?: string; }`
  - `selectActiveRuns(runs: Run[]): Run[]`
  - `computeAgentHealth(runs: Run[], agents: Agent[]): AgentHealth[]`
  - `filterFeed(runs: Run[], filter: FeedFilter): Run[]`

- [ ] **Step 1: Add the Vitest dependency and test script**

Run: `cd apps/client && npm install -D vitest@^2.1.0`

Then edit `apps/client/package.json` — add a `test` script so the `scripts` block reads:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Configure Vitest in `vite.config.ts`**

Replace the contents of `apps/client/vite.config.ts` with (switches the import to `vitest/config` and adds a node-environment `test` block; the existing dev/proxy config is unchanged):

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Write the failing tests**

Create `apps/client/src/lib/runStats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Run, Agent } from '../api/client.js';
import { selectActiveRuns, computeAgentHealth, filterFeed } from './runStats.js';

function run(p: Partial<Run> & { id: string; agentId: string; status: string; createdAt: string }): Run {
  return {
    trigger: 'manual', result: null, error: null, finishedAt: null, ...p,
  } as Run;
}
function agent(id: string, name: string): Agent {
  return { id, name } as unknown as Agent;
}

const agents = [agent('a1', 'Alpha'), agent('a2', 'Beta'), agent('a3', 'Gamma')];
const runs: Run[] = [
  run({ id: 'r1', agentId: 'a1', status: 'done',    createdAt: '2026-06-24T10:00:00.000Z' }),
  run({ id: 'r2', agentId: 'a1', status: 'failed',  createdAt: '2026-06-24T11:00:00.000Z' }),
  run({ id: 'r3', agentId: 'a1', status: 'running', createdAt: '2026-06-24T12:00:00.000Z' }),
  run({ id: 'r4', agentId: 'a2', status: 'pending', createdAt: '2026-06-24T09:30:00.000Z' }),
];

describe('selectActiveRuns', () => {
  it('returns only pending/running, newest first', () => {
    const active = selectActiveRuns(runs);
    expect(active.map((r) => r.id)).toEqual(['r3', 'r4']);
  });
  it('does not mutate the input array', () => {
    const input = [...runs];
    selectActiveRuns(input);
    expect(input.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('computeAgentHealth', () => {
  it('counts done/failed/running and computes success rate', () => {
    const health = computeAgentHealth(runs, agents);
    const a1 = health.find((h) => h.agent.id === 'a1')!;
    expect(a1.total).toBe(3);
    expect(a1.done).toBe(1);
    expect(a1.failed).toBe(1);
    expect(a1.running).toBe(1);
    expect(a1.successRate).toBe(0.5);
    expect(a1.lastRunAt).toBe('2026-06-24T12:00:00.000Z');
    expect(a1.lastStatus).toBe('running');
  });
  it('returns null success rate for an agent with no finished runs', () => {
    const a2 = computeAgentHealth(runs, agents).find((h) => h.agent.id === 'a2')!;
    expect(a2.running).toBe(1);
    expect(a2.successRate).toBeNull();
  });
  it('zeroes an agent with no runs', () => {
    const a3 = computeAgentHealth(runs, agents).find((h) => h.agent.id === 'a3')!;
    expect(a3).toMatchObject({ total: 0, done: 0, failed: 0, running: 0, successRate: null, lastRunAt: null, lastStatus: null });
  });
  it('returns one entry per agent, in agents order', () => {
    expect(computeAgentHealth(runs, agents).map((h) => h.agent.id)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('filterFeed', () => {
  it('returns all runs newest-first with an empty filter', () => {
    expect(filterFeed(runs, {}).map((r) => r.id)).toEqual(['r3', 'r2', 'r1', 'r4']);
  });
  it('filters by agentId', () => {
    expect(filterFeed(runs, { agentId: 'a1' }).map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });
  it('filters by status', () => {
    expect(filterFeed(runs, { status: 'failed' }).map((r) => r.id)).toEqual(['r2']);
  });
  it('treats empty-string filters as no filter', () => {
    expect(filterFeed(runs, { agentId: '', status: '' })).toHaveLength(4);
  });
  it('does not mutate the input array', () => {
    const input = [...runs];
    filterFeed(input, { agentId: 'a1' });
    expect(input).toHaveLength(4);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd apps/client && npx vitest run runStats`
Expected: FAIL — `Failed to resolve import "./runStats.js"` / functions not defined.

- [ ] **Step 5: Implement `runStats.ts`**

Create `apps/client/src/lib/runStats.ts`:

```ts
import type { Run, Agent } from '../api/client.js';

export interface AgentHealth {
  agent: Agent;
  total: number;
  done: number;
  failed: number;
  running: number;
  successRate: number | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface FeedFilter {
  agentId?: string;
  status?: string;
}

const ACTIVE = new Set(['pending', 'running']);

const byCreatedDesc = (a: Run, b: Run): number => b.createdAt.localeCompare(a.createdAt);

export function selectActiveRuns(runs: Run[]): Run[] {
  return runs.filter((r) => ACTIVE.has(r.status)).sort(byCreatedDesc);
}

export function computeAgentHealth(runs: Run[], agents: Agent[]): AgentHealth[] {
  return agents.map((agent) => {
    const own = runs.filter((r) => r.agentId === agent.id).sort(byCreatedDesc);
    const done = own.filter((r) => r.status === 'done').length;
    const failed = own.filter((r) => r.status === 'failed').length;
    const running = own.filter((r) => ACTIVE.has(r.status)).length;
    const finished = done + failed;
    return {
      agent,
      total: own.length,
      done,
      failed,
      running,
      successRate: finished === 0 ? null : done / finished,
      lastRunAt: own.length > 0 ? own[0].createdAt : null,
      lastStatus: own.length > 0 ? own[0].status : null,
    };
  });
}

export function filterFeed(runs: Run[], filter: FeedFilter): Run[] {
  return runs
    .filter((r) => (filter.agentId ? r.agentId === filter.agentId : true))
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .sort(byCreatedDesc);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/client && npx vitest run runStats`
Expected: PASS — all suites green.

- [ ] **Step 7: Commit**

```bash
git add apps/client/package.json apps/client/package-lock.json apps/client/vite.config.ts apps/client/src/lib/runStats.ts apps/client/src/lib/runStats.test.ts
git commit -m "feat(client): add runStats aggregation module + vitest setup"
```

---

### Task 2: `NowStrip` component

**Files:**
- Create: `apps/client/src/components/NowStrip.tsx`

**Interfaces:**
- Consumes: `Run` from `../api/client.js`; `RunStatusBadge` from `./RunStatusBadge.js`.
- Produces: `NowStrip({ runs, agentsById }: { runs: Run[]; agentsById: Record<string, Agent> })`.

- [ ] **Step 1: Create the component**

Create `apps/client/src/components/NowStrip.tsx`:

```tsx
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { type Run, type Agent } from '../api/client.js';
import { RunStatusBadge } from './RunStatusBadge.js';

interface Props { runs: Run[]; agentsById: Record<string, Agent>; }

export function NowStrip({ runs, agentsById }: Props) {
  return (
    <Box mb={3}>
      <Typography variant="subtitle2" gutterBottom>Running now</Typography>
      {runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nothing running right now.</Typography>
      ) : (
        <Box display="flex" gap={1.5} flexWrap="wrap">
          {runs.map((run) => (
            <Paper key={run.id} variant="outlined" sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">{agentsById[run.agentId]?.name ?? run.agentId.slice(0, 8)}</Typography>
              <RunStatusBadge status={run.status} />
              <Typography variant="caption" color="text.secondary">
                {new Date(run.createdAt).toLocaleTimeString()}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/NowStrip.tsx
git commit -m "feat(client): add NowStrip component"
```

---

### Task 3: `AgentHealthTiles` component

**Files:**
- Create: `apps/client/src/components/AgentHealthTiles.tsx`

**Interfaces:**
- Consumes: `AgentHealth` from `../lib/runStats.js`; `AgentAvatar` from `./AgentAvatar.js`; `useNavigate` from `react-router-dom`.
- Produces: `AgentHealthTiles({ health }: { health: AgentHealth[] })`.

- [ ] **Step 1: Create the component**

Create `apps/client/src/components/AgentHealthTiles.tsx`:

```tsx
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { useNavigate } from 'react-router-dom';
import { type AgentHealth } from '../lib/runStats.js';
import { AgentAvatar } from './AgentAvatar.js';

interface Props { health: AgentHealth[]; }

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function AgentHealthTiles({ health }: Props) {
  const navigate = useNavigate();

  return (
    <Box mb={3}>
      <Typography variant="subtitle2" gutterBottom>Agents</Typography>
      {health.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No agents yet.</Typography>
      ) : (
        <Box display="flex" gap={2} flexWrap="wrap">
          {health.map((h) => (
            <Paper
              key={h.agent.id}
              variant="outlined"
              sx={{ p: 2, minWidth: 220, cursor: 'pointer' }}
              onClick={() => navigate(`/agents/${h.agent.id}`)}
            >
              <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                <AgentAvatar avatarKey={h.agent.avatarKey} name={h.agent.name} size={36} />
                <Box flex={1} minWidth={0}>
                  <Typography variant="subtitle2" noWrap>{h.agent.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {h.lastRunAt ? `Last run ${new Date(h.lastRunAt).toLocaleString()}` : 'Never run'}
                  </Typography>
                </Box>
                {h.running > 0 && <Chip label="running" color="info" size="small" />}
              </Box>
              <Box display="flex" gap={1} alignItems="center">
                <Chip label={`✓ ${h.done}`} color="success" size="small" variant="outlined" />
                <Chip label={`✗ ${h.failed}`} color="error" size="small" variant="outlined" />
                <Typography variant="body2" color="text.secondary">{formatRate(h.successRate)} success</Typography>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/AgentHealthTiles.tsx
git commit -m "feat(client): add AgentHealthTiles component"
```

---

### Task 4: `ActivityFeed` component

**Files:**
- Create: `apps/client/src/components/ActivityFeed.tsx`

**Interfaces:**
- Consumes: `Run`, `Agent` from `../api/client.js`; `FeedFilter` from `../lib/runStats.js`; `RunStatusBadge` from `./RunStatusBadge.js`; `useNavigate`.
- Produces: `ActivityFeed({ runs, agents, agentsById, filter, onFilterChange }: { runs: Run[]; agents: Agent[]; agentsById: Record<string, Agent>; filter: FeedFilter; onFilterChange: (f: FeedFilter) => void })` where `runs` is the already-filtered feed.

- [ ] **Step 1: Create the component**

Create `apps/client/src/components/ActivityFeed.tsx`:

```tsx
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { useNavigate } from 'react-router-dom';
import { type Run, type Agent } from '../api/client.js';
import { type FeedFilter } from '../lib/runStats.js';
import { RunStatusBadge } from './RunStatusBadge.js';

const STATUSES = ['pending', 'running', 'done', 'failed'];

interface Props {
  runs: Run[];
  agents: Agent[];
  agentsById: Record<string, Agent>;
  filter: FeedFilter;
  onFilterChange: (f: FeedFilter) => void;
}

function duration(run: Run): string {
  if (!run.finishedAt) return '-';
  return `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)}s`;
}

export function ActivityFeed({ runs, agents, agentsById, filter, onFilterChange }: Props) {
  const navigate = useNavigate();

  return (
    <Box>
      <Box display="flex" gap={2} alignItems="center" mb={1}>
        <Typography variant="subtitle2" flex={1}>Activity</Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Agent</InputLabel>
          <Select
            label="Agent"
            value={filter.agentId ?? ''}
            onChange={(e) => onFilterChange({ ...filter, agentId: e.target.value })}
          >
            <MenuItem value="">All agents</MenuItem>
            {agents.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={filter.status ?? ''}
            onChange={(e) => onFilterChange({ ...filter, status: e.target.value })}
          >
            <MenuItem value="">All statuses</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Agent</TableCell>
            <TableCell>Trigger</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Duration</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/runs/${run.id}`)}>
              <TableCell>{agentsById[run.agentId]?.name ?? run.agentId.slice(0, 8)}</TableCell>
              <TableCell>{run.trigger}</TableCell>
              <TableCell><RunStatusBadge status={run.status} /></TableCell>
              <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
              <TableCell>{duration(run)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {runs.length === 0 && (
        <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>No runs match.</Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/components/ActivityFeed.tsx
git commit -m "feat(client): add ActivityFeed component"
```

---

### Task 5: `MonitoringDashboard` page + routing + nav + delete Run History

**Files:**
- Create: `apps/client/src/pages/MonitoringDashboard.tsx`
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/components/Layout.tsx`
- Delete: `apps/client/src/pages/RunHistoryPage.tsx`

**Interfaces:**
- Consumes: `useRuns`, `useAgents`, `selectActiveRuns`, `computeAgentHealth`, `filterFeed`, `FeedFilter`, and the three components from Tasks 2–4.

- [ ] **Step 1: Create the dashboard page**

Create `apps/client/src/pages/MonitoringDashboard.tsx`:

```tsx
import { useMemo, useState } from 'react';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { useRuns } from '../hooks/useRuns.js';
import { useAgents } from '../hooks/useAgents.js';
import { selectActiveRuns, computeAgentHealth, filterFeed, type FeedFilter } from '../lib/runStats.js';
import { NowStrip } from '../components/NowStrip.js';
import { AgentHealthTiles } from '../components/AgentHealthTiles.js';
import { ActivityFeed } from '../components/ActivityFeed.js';

export function MonitoringDashboard() {
  const { data: runs, isLoading, isError } = useRuns();
  const { data: agents } = useAgents();
  const [filter, setFilter] = useState<FeedFilter>({});

  const runList = runs ?? [];
  const agentList = agents ?? [];

  const agentsById = useMemo(
    () => Object.fromEntries(agentList.map((a) => [a.id, a])),
    [agentList]
  );
  const active = useMemo(() => selectActiveRuns(runList), [runList]);
  const health = useMemo(() => computeAgentHealth(runList, agentList), [runList, agentList]);
  const feed = useMemo(() => filterFeed(runList, filter), [runList, filter]);

  if (isLoading) return <CircularProgress sx={{ mt: 2 }} />;
  if (isError) return <Typography color="error">Failed to load. Is the server running?</Typography>;

  return (
    <>
      <Typography variant="h5" gutterBottom>Activity</Typography>
      <NowStrip runs={active} agentsById={agentsById} />
      <AgentHealthTiles health={health} />
      <ActivityFeed
        runs={feed}
        agents={agentList}
        agentsById={agentsById}
        filter={filter}
        onFilterChange={setFilter}
      />
    </>
  );
}
```

- [ ] **Step 2: Wire the route**

In `apps/client/src/App.tsx`, replace the import line:

```tsx
import { RunHistoryPage } from './pages/RunHistoryPage.js';
```

with:

```tsx
import { MonitoringDashboard } from './pages/MonitoringDashboard.js';
```

and replace the route:

```tsx
              <Route path="/runs" element={<RunHistoryPage />} />
```

with:

```tsx
              <Route path="/runs" element={<MonitoringDashboard />} />
```

(Leave `/runs/:id` → `RunDetailPage` and all other routes unchanged.)

- [ ] **Step 3: Relabel the nav item**

In `apps/client/src/components/Layout.tsx`, change the `NAV` entry from:

```tsx
  { label: 'Run History', path: '/runs' },
```

to:

```tsx
  { label: 'Activity', path: '/runs' },
```

- [ ] **Step 4: Delete the old page**

Run: `git rm apps/client/src/pages/RunHistoryPage.tsx`

- [ ] **Step 5: Typecheck**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors (confirms nothing else imported `RunHistoryPage`).

- [ ] **Step 6: Run the full client tests**

Run: `cd apps/client && npx vitest run`
Expected: PASS — `runStats` suite green.

- [ ] **Step 7: Manual smoke check**

With the dev stack running (`npm run dev:server`, `npm run dev:client`): open the dashboard at `/runs`. Confirm the "Activity" nav item is selected; the "Running now" strip shows in-progress runs (or its empty state); agent tiles show avatar, last-run, ✓/✗ counts, success rate; the feed lists runs and filters by agent and status; clicking a feed row opens `/runs/:id`; clicking a tile opens `/agents/:id`. Trigger a run and confirm it appears in the strip then moves to the feed as it completes.

- [ ] **Step 8: Commit**

```bash
git add apps/client/src/pages/MonitoringDashboard.tsx apps/client/src/App.tsx apps/client/src/components/Layout.tsx
git commit -m "feat(client): monitoring dashboard at /runs, replacing Run History"
```

---

## Self-Review

- **Spec coverage:** now strip (Task 2) ✓; per-agent health tiles (Task 3) ✓; filterable activity feed replacing Run History (Tasks 4–5) ✓; client-side aggregation via pure `runStats` (Task 1) ✓; reuse `AgentAvatar`/`RunStatusBadge` (Tasks 3/2/4) ✓; route `/runs`→dashboard, `/runs/:id` unchanged, delete `RunHistoryPage`, nav relabel (Task 5) ✓; Vitest added + `runStats` tested (Task 1) ✓; 5s polling reused via `useRuns` (Task 5) ✓; null-safe success rate and copy-not-mutate (Task 1 tests assert both) ✓; non-goals (no server/websockets/sub-agents) respected ✓.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `AgentHealth`/`FeedFilter`/`selectActiveRuns`/`computeAgentHealth`/`filterFeed` signatures match across Tasks 1→2/3/4/5; `agentsById` is `Record<string, Agent>` everywhere; `ActivityFeed` receives the already-filtered `runs` plus full `agents` for the dropdown; `AgentAvatar` props (`avatarKey`, `name`, `size`) and `RunStatusBadge` (`status`) match their definitions.
