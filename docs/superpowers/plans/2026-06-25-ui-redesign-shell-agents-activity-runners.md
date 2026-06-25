# Agent Hub UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the app shell and the Agents, Activity, and Runners screens of `globale.agent-hub`'s client to match the supplied mockups — denser, finished-looking, consistent surfaces — without backend changes or new dependencies.

**Architecture:** Frontend-only (`apps/client`). Promote the existing dashboard token module into the MUI theme so all screens share one elevation system. Push all derivable display data (per-agent run stats, live status, sparkline markers, trigger summary, runner counts) into **pure, node-testable helper functions**, keeping React components thin presentational wrappers. Reuse existing derivations (`computeAgentHealth`, `buildWorkerCards`/`stateFor`, `relativeTime`, `runMarker`, `stateStyles`) rather than re-deriving.

**Tech Stack:** React 18, MUI v7 (`@mui/material`, `@mui/icons-material`), Vite 5, Vitest 2 (node environment), Zustand, React Router 6, `@dnd-kit`, TanStack Query 5.

## Global Constraints

- **No new npm dependencies.** Icons come from the already-installed `@mui/icons-material`. (Do NOT add `lucide-react`, `jsdom`, or `@testing-library/*`.)
- **No backend, API, runner, or DB changes.** The `Runner` model stays `{id, name, status, lastSeen}`. No new endpoints.
- **Tests are pure-logic only, in vitest's `node` environment** (the client's existing setup — see [vite.config.ts](../../../apps/client/vite.config.ts) `test.environment: 'node'`). There is no Testing Library / jsdom, and we are not adding it. **Do not write React-rendering tests.** UI-only changes are verified by typecheck (`npx tsc -p .`, which is a real check because [tsconfig.json](../../../apps/client/tsconfig.json) sets `noEmit: true`) and `npm run build`.
- **Spec source of truth:** [docs/superpowers/specs/2026-06-25-ui-redesign-shell-agents-activity-runners-design.md](../specs/2026-06-25-ui-redesign-shell-agents-activity-runners-design.md).
- **Canonical wordmark casing is "Agent hub"** (not "Agent Hub"). Button copy: **"New agent"**, **"Add runner"**.
- **Status-pill labels are whatever `stateStyles[state].label` returns** — Working / Reviewing / Queued / Idle / Blocked. Do not invent literal "Running"/"Failed" labels.
- **Runners screen intentionally omits Platform / Version / Jobs / Capacity** (no data). No fake values.
- **The single design-token source is** [apps/client/src/components/dashboard/palette.ts](../../../apps/client/src/components/dashboard/palette.ts) (`colors`, `stateStyles`, `runMarker`, `WorkerState`).
- **All commands below run from `apps/client/`** unless stated. The shell is Git Bash (POSIX).
- Commit after each task. Conventional Commits style.

---

## File Structure

**New files (`apps/client/src/`):**
- `lib/cardView.ts` — pure: `summarizeTrigger`, `buildAgentCardModels`, `matchesStatusFilter`, `isRunningState`, `AgentCardModel`, `StatusFilter`, `MARKER_COUNT`.
- `lib/cardView.test.ts` — tests for the above.
- `lib/runners.ts` — pure: `runnerStats`.
- `lib/runners.test.ts` — tests for `runnerStats`.
- `components/StatusPill.tsx` — status pill driven by `stateStyles`.
- `components/Sparkline.tsx` — thin recent-runs bar strip.
- `components/StatCard.tsx` — shared metric card (Activity + Runners).
- `components/WorkspaceChip.tsx` — static workspace identity chip (sidebar).
- `components/SidebarAccount.tsx` — static account block (sidebar footer).
- `components/RunnerConnectDialog.tsx` — static "connect a runner" instructions dialog.

**Modified files (`apps/client/src/`):**
- `lib/runStats.ts` — add `recentRunMarkers`.
- `lib/runStats.test.ts` — add `recentRunMarkers` tests.
- `theme.ts` — wire MUI theme from `palette.ts` tokens.
- `components/Layout.tsx` — rebuild sidebar.
- `components/AgentCard.tsx` — restructured card.
- `components/SortableAgentCard.tsx` — forward the card model.
- `pages/AgentsPage.tsx` — responsive grid, search + status filter, build card models.
- `pages/MonitoringDashboard.tsx` — title "Activity", drop `m:-3`.
- `components/dashboard/StatCards.tsx` — use shared `StatCard`, tighter.
- `components/dashboard/PipelineStrip.tsx` — real MUI icons.

**Unchanged but verified:** `components/dashboard/ActivityList.tsx` already renders leading colored markers + `relativeTime` — no change needed (Task 6 verifies this).

---

## Task 1: Wire the MUI theme from shared tokens

**Files:**
- Modify: `apps/client/src/theme.ts` (full rewrite, 11 lines → ~40)

**Interfaces:**
- Consumes: `colors` from `components/dashboard/palette.ts` (`pageBg`, `card`, `cardBorder`, `text`, `textMuted`).
- Produces: a theme where `background.default = colors.pageBg`, `background.paper = colors.card`, and `MuiCard`/`MuiPaper` have a unified border + no elevation overlay. Later tasks rely on `bgcolor: 'background.default'` / `'background.paper'` and on cards defaulting to the shared surface.

- [ ] **Step 1: Rewrite `theme.ts`**

```ts
import { createTheme } from '@mui/material/styles';
import { colors } from './components/dashboard/palette.js';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#89b4fa' },
    info: { main: '#5b9bff' },
    success: { main: '#4ade80' },
    warning: { main: '#e6b65c' },
    error: { main: '#f0706f' },
    background: { default: colors.pageBg, paper: colors.card },
    divider: colors.cardBorder,
    text: { primary: colors.text, secondary: colors.textMuted },
  },
  typography: { fontFamily: '"Inter", "Roboto", sans-serif' },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: colors.card,
          backgroundImage: 'none',
          border: `1px solid ${colors.cardBorder}`,
          borderRadius: 12,
        },
      },
    },
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p .`
Expected: no output, exit 0.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds (`tsc` + `vite build` complete, no errors).

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/theme.ts
git commit -m "feat(client): wire MUI theme from shared design tokens"
```

---

## Task 2: Pure display helpers + tests

This task carries all the unit-tested logic. TDD: write tests first, then implement.

**Files:**
- Modify: `apps/client/src/lib/runStats.ts` (add `recentRunMarkers`)
- Modify: `apps/client/src/lib/runStats.test.ts` (add tests)
- Create: `apps/client/src/lib/cardView.ts`
- Create: `apps/client/src/lib/cardView.test.ts`
- Create: `apps/client/src/lib/runners.ts`
- Create: `apps/client/src/lib/runners.test.ts`

**Interfaces:**
- Consumes: `Run`, `Agent`, `Runner` from `api/client.ts`; `AgentHealth`, `computeAgentHealth` from `runStats.ts`; `WorkerState`, `buildWorkerCards` / `stateFor` from `lib/dashboard.ts`.
- Produces (relied on by Tasks 5 and 7):
  - `recentRunMarkers(runs: Run[], agentId: string, n: number): string[]` — last `n` **non-archived** run statuses for the agent, ordered **oldest→newest**; length ≤ `n`.
  - `MARKER_COUNT = 10` (number).
  - `AgentCardModel = { health: AgentHealth; state: WorkerState; markers: string[]; latest: Run | null }`.
  - `buildAgentCardModels(agents: Agent[], runs: Run[]): Map<string, AgentCardModel>` — keyed by agent id.
  - `StatusFilter = 'all' | 'running' | 'idle'`.
  - `isRunningState(state: WorkerState): boolean` — true for `working`/`reviewing`/`queued`.
  - `matchesStatusFilter(state: WorkerState, filter: StatusFilter): boolean`.
  - `summarizeTrigger(triggerRulesJson: string | null | undefined): string`.
  - `runnerStats(runners: Runner[]): { online: number; total: number }`.

- [ ] **Step 1: Add `recentRunMarkers` tests to `runStats.test.ts`**

Append to the end of `apps/client/src/lib/runStats.test.ts` (the file already imports `Run`, `Agent`, and defines `run`/`runs`; add the import and a new describe block):

```ts
// add to the existing import line:
import { selectActiveRuns, computeAgentHealth, filterFeed, recentRunMarkers } from './runStats.js';

describe('recentRunMarkers', () => {
  it('returns the agent\'s run statuses oldest-first, ignoring archived', () => {
    // a1 non-archived runs: r1 done (10:00), r2 failed (11:00), r3 running (12:00)
    expect(recentRunMarkers(runs, 'a1', 10)).toEqual(['done', 'failed', 'running']);
  });
  it('caps to the most recent n, still oldest-first within that window', () => {
    expect(recentRunMarkers(runs, 'a1', 2)).toEqual(['failed', 'running']);
  });
  it('returns an empty array for an agent with no runs', () => {
    expect(recentRunMarkers(runs, 'a3', 10)).toEqual([]);
  });
  it('does not mutate the input array', () => {
    const input = [...runs];
    recentRunMarkers(input, 'a1', 10);
    expect(input).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run the new tests — verify they FAIL**

Run: `npx vitest run src/lib/runStats.test.ts`
Expected: FAIL — `recentRunMarkers is not exported` / `is not a function`.

- [ ] **Step 3: Implement `recentRunMarkers` in `runStats.ts`**

Append to `apps/client/src/lib/runStats.ts` (reuses the existing `byCreatedDesc`):

```ts
export function recentRunMarkers(runs: Run[], agentId: string, n: number): string[] {
  const own = runs
    .filter((r) => r.agentId === agentId && !r.archived)
    .sort(byCreatedDesc) // newest first
    .slice(0, n) // most recent n
    .map((r) => r.status);
  return own.reverse(); // oldest -> newest
}
```

- [ ] **Step 4: Run the tests — verify they PASS**

Run: `npx vitest run src/lib/runStats.test.ts`
Expected: PASS (all describe blocks, including the original ones).

- [ ] **Step 5: Write `cardView.test.ts`**

Create `apps/client/src/lib/cardView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Run, Agent } from '../api/client.js';
import {
  summarizeTrigger, matchesStatusFilter, isRunningState, buildAgentCardModels,
} from './cardView.js';

function run(p: Partial<Run> & { id: string; agentId: string; status: string; createdAt: string }): Run {
  return { trigger: 'manual', result: null, error: null, finishedAt: null, ...p } as Run;
}
function agent(p: Partial<Agent> & { id: string; name: string }): Agent {
  return { type: 'general', model: 'sonnet', triggerRules: '', archived: false, ...p } as unknown as Agent;
}

describe('summarizeTrigger', () => {
  it('prefers a jira label', () => {
    expect(summarizeTrigger(JSON.stringify({ events: ['mr.opened'], jiraLabel: 'ai-build' })))
      .toBe('on Jira label');
  });
  it('falls back to the first event', () => {
    expect(summarizeTrigger(JSON.stringify({ events: ['mr.opened'] }))).toBe('on mr.opened');
  });
  it('returns "manual" for empty / missing / unparseable rules', () => {
    expect(summarizeTrigger('')).toBe('manual');
    expect(summarizeTrigger(null)).toBe('manual');
    expect(summarizeTrigger('not json')).toBe('manual');
    expect(summarizeTrigger(JSON.stringify({ events: [] }))).toBe('manual');
  });
});

describe('isRunningState / matchesStatusFilter', () => {
  it('isRunningState is true for active states only', () => {
    expect(isRunningState('working')).toBe(true);
    expect(isRunningState('reviewing')).toBe(true);
    expect(isRunningState('queued')).toBe(true);
    expect(isRunningState('idle')).toBe(false);
    expect(isRunningState('blocked')).toBe(false);
  });
  it('"all" matches everything', () => {
    expect(matchesStatusFilter('idle', 'all')).toBe(true);
    expect(matchesStatusFilter('working', 'all')).toBe(true);
  });
  it('"running" matches active states', () => {
    expect(matchesStatusFilter('working', 'running')).toBe(true);
    expect(matchesStatusFilter('idle', 'running')).toBe(false);
  });
  it('"idle" matches idle and blocked', () => {
    expect(matchesStatusFilter('idle', 'idle')).toBe(true);
    expect(matchesStatusFilter('blocked', 'idle')).toBe(true);
    expect(matchesStatusFilter('working', 'idle')).toBe(false);
  });
});

describe('buildAgentCardModels', () => {
  const agents = [agent({ id: 'a1', name: 'Alpha' }), agent({ id: 'a2', name: 'Beta' })];
  const runs: Run[] = [
    run({ id: 'r1', agentId: 'a1', status: 'done', createdAt: '2026-06-24T10:00:00.000Z' }),
    run({ id: 'r2', agentId: 'a1', status: 'running', createdAt: '2026-06-24T12:00:00.000Z' }),
  ];
  it('produces one model per agent keyed by id', () => {
    const models = buildAgentCardModels(agents, runs);
    expect([...models.keys()].sort()).toEqual(['a1', 'a2']);
  });
  it('carries health, markers (oldest-first), latest run, and a live state', () => {
    const m = buildAgentCardModels(agents, runs).get('a1')!;
    expect(m.health.total).toBe(2);
    expect(m.markers).toEqual(['done', 'running']);
    expect(m.latest?.id).toBe('r2');
    expect(m.state).toBe('working'); // latest is running, non-reviewer agent
  });
  it('gives a runless agent an idle state and empty markers', () => {
    const m = buildAgentCardModels(agents, runs).get('a2')!;
    expect(m.state).toBe('idle');
    expect(m.markers).toEqual([]);
    expect(m.latest).toBeNull();
  });
});
```

- [ ] **Step 6: Run cardView tests — verify they FAIL**

Run: `npx vitest run src/lib/cardView.test.ts`
Expected: FAIL — module `./cardView.js` not found.

- [ ] **Step 7: Implement `cardView.ts`**

Create `apps/client/src/lib/cardView.ts`:

```ts
import type { Run, Agent } from '../api/client.js';
import type { WorkerState } from '../components/dashboard/palette.js';
import { computeAgentHealth, recentRunMarkers, type AgentHealth } from './runStats.js';
import { buildWorkerCards } from './dashboard.js';

export const MARKER_COUNT = 10;

export interface AgentCardModel {
  health: AgentHealth;
  state: WorkerState;
  markers: string[];
  latest: Run | null;
}

export type StatusFilter = 'all' | 'running' | 'idle';

export function isRunningState(state: WorkerState): boolean {
  return state === 'working' || state === 'reviewing' || state === 'queued';
}

export function matchesStatusFilter(state: WorkerState, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return isRunningState(state);
  return !isRunningState(state); // 'idle' bucket: idle + blocked
}

export function summarizeTrigger(triggerRulesJson: string | null | undefined): string {
  let rules: { events?: string[]; jiraLabel?: string } = {};
  try { rules = JSON.parse(triggerRulesJson || '') ?? {}; } catch { return 'manual'; }
  if (rules.jiraLabel) return 'on Jira label';
  if (rules.events && rules.events.length > 0) return `on ${rules.events[0]}`;
  return 'manual';
}

export function buildAgentCardModels(agents: Agent[], runs: Run[]): Map<string, AgentCardModel> {
  const healthById = new Map(computeAgentHealth(runs, agents).map((h) => [h.agent.id, h]));
  const cardById = new Map(buildWorkerCards(agents, runs).map((c) => [c.agent.id, c]));
  const models = new Map<string, AgentCardModel>();
  for (const agent of agents) {
    const card = cardById.get(agent.id);
    models.set(agent.id, {
      health: healthById.get(agent.id)!,
      state: card?.state ?? 'idle',
      latest: card?.latest ?? null,
      markers: recentRunMarkers(runs, agent.id, MARKER_COUNT),
    });
  }
  return models;
}
```

- [ ] **Step 8: Run cardView tests — verify they PASS**

Run: `npx vitest run src/lib/cardView.test.ts`
Expected: PASS.

- [ ] **Step 9: Write `runners.test.ts`**

Create `apps/client/src/lib/runners.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Runner } from '../api/client.js';
import { runnerStats } from './runners.js';

function runner(id: string, status: string): Runner {
  return { id, name: id, status, lastSeen: '2026-06-24T10:00:00.000Z' };
}

describe('runnerStats', () => {
  it('counts online and total', () => {
    const stats = runnerStats([runner('a', 'online'), runner('b', 'offline'), runner('c', 'online')]);
    expect(stats).toEqual({ online: 2, total: 3 });
  });
  it('treats any non-online status as not online', () => {
    expect(runnerStats([runner('a', 'idle'), runner('b', 'stale')])).toEqual({ online: 0, total: 2 });
  });
  it('handles an empty list', () => {
    expect(runnerStats([])).toEqual({ online: 0, total: 0 });
  });
});
```

- [ ] **Step 10: Run runners tests — verify they FAIL**

Run: `npx vitest run src/lib/runners.test.ts`
Expected: FAIL — module `./runners.js` not found.

- [ ] **Step 11: Implement `runners.ts`**

Create `apps/client/src/lib/runners.ts`:

```ts
import type { Runner } from '../api/client.js';

export function runnerStats(runners: Runner[]): { online: number; total: number } {
  return {
    online: runners.filter((r) => r.status === 'online').length,
    total: runners.length,
  };
}
```

- [ ] **Step 12: Run the full lib test suite — verify all PASS**

Run: `npx vitest run`
Expected: PASS — all files (`dashboard.test.ts`, `reorder.test.ts`, `runStats.test.ts`, `cardView.test.ts`, `runners.test.ts`).

- [ ] **Step 13: Typecheck + commit**

Run: `npx tsc -p .` → exit 0.

```bash
git add apps/client/src/lib/runStats.ts apps/client/src/lib/runStats.test.ts apps/client/src/lib/cardView.ts apps/client/src/lib/cardView.test.ts apps/client/src/lib/runners.ts apps/client/src/lib/runners.test.ts
git commit -m "feat(client): add pure display helpers for cards and runners"
```

---

## Task 3: Shared presentational primitives

**Files:**
- Create: `apps/client/src/components/StatusPill.tsx`
- Create: `apps/client/src/components/Sparkline.tsx`
- Create: `apps/client/src/components/StatCard.tsx`

**Interfaces:**
- Consumes: `stateStyles`, `WorkerState`, `runMarker`, `colors` from `components/dashboard/palette.ts`.
- Produces (used by Tasks 5, 6, 7):
  - `<StatusPill state={WorkerState} />`
  - `<Sparkline markers={string[]} count?={number} />` (default count 10)
  - `<StatCard label={string} value={string|number} accent?={string} />`

- [ ] **Step 1: Create `StatusPill.tsx`**

```tsx
import Box from '@mui/material/Box';
import { stateStyles, type WorkerState } from './dashboard/palette.js';

export function StatusPill({ state }: { state: WorkerState }) {
  const s = stateStyles[state];
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        px: 1, py: 0.25, borderRadius: 999, fontSize: 12, fontWeight: 600,
        color: s.fg, bgcolor: s.bg, whiteSpace: 'nowrap', lineHeight: 1.6,
      }}
    >
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: s.fg }} />
      {s.label}
    </Box>
  );
}
```

- [ ] **Step 2: Create `Sparkline.tsx`**

```tsx
import Box from '@mui/material/Box';
import { runMarker, colors } from './dashboard/palette.js';

export function Sparkline({ markers, count = 10 }: { markers: string[]; count?: number }) {
  const recent = markers.slice(-count);
  const pad = Math.max(0, count - recent.length);
  const slots: (string | null)[] = [...Array(pad).fill(null), ...recent];
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end', height: 18 }}>
      {slots.map((status, i) => (
        <Box
          key={i}
          sx={{
            flex: 1,
            height: status ? 18 : 8,
            borderRadius: 0.5,
            bgcolor: status ? (runMarker[status] ?? colors.textFaint) : 'rgba(255,255,255,0.06)',
          }}
        />
      ))}
    </Box>
  );
}
```

- [ ] **Step 3: Create `StatCard.tsx`**

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from './dashboard/palette.js';

interface Props { label: string; value: string | number; accent?: string; }

export function StatCard({ label, value, accent }: Props) {
  return (
    <Box sx={{ bgcolor: colors.card, border: `1px solid ${colors.cardBorder}`, borderRadius: 3, px: 2.5, py: 1.75 }}>
      <Typography sx={{ color: colors.textMuted, fontSize: 13, mb: 0.75 }}>{label}</Typography>
      <Typography sx={{ color: accent ?? colors.text, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p .`
Expected: exit 0. (These components are unused so far; typecheck confirms they compile.)

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/StatusPill.tsx apps/client/src/components/Sparkline.tsx apps/client/src/components/StatCard.tsx
git commit -m "feat(client): add StatusPill, Sparkline, StatCard primitives"
```

---

## Task 4: Rebuild the app shell / sidebar

**Files:**
- Create: `apps/client/src/components/WorkspaceChip.tsx`
- Create: `apps/client/src/components/SidebarAccount.tsx`
- Modify: `apps/client/src/components/Layout.tsx` (full rewrite)

**Interfaces:**
- Consumes: `colors` from palette; MUI icons `SmartToyIcon`, `InsightsIcon`, `DnsIcon`, `HubIcon`, `UnfoldMoreIcon`, `SettingsIcon`; React Router `useNavigate`/`useLocation`.
- Produces: a permanent drawer with header (mark + "Agent hub"), `WorkspaceChip`, icon nav with accent-bar active state, and a pinned `SidebarAccount`. The `<main>` area now paints `colors.pageBg`, so pages no longer need to bleed past padding.

- [ ] **Step 1: Create `WorkspaceChip.tsx`**

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { colors } from './dashboard/palette.js';

export function WorkspaceChip() {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1.5, py: 1, mx: 2, mb: 1,
        border: `1px solid ${colors.cardBorder}`, borderRadius: 2,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ color: colors.text, fontSize: 14, fontWeight: 600, lineHeight: 1.2 }} noWrap>
          Global-E · CORE
        </Typography>
        <Typography sx={{ color: colors.textMuted, fontSize: 12 }} noWrap>Workspace</Typography>
      </Box>
      <UnfoldMoreIcon sx={{ fontSize: 18, color: colors.textMuted }} />
    </Box>
  );
}
```

- [ ] **Step 2: Create `SidebarAccount.tsx`**

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import SettingsIcon from '@mui/icons-material/Settings';
import { colors } from './dashboard/palette.js';

export function SidebarAccount() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, borderTop: `1px solid ${colors.cardBorder}` }}>
      <Box
        sx={{
          width: 34, height: 34, borderRadius: '50%', bgcolor: '#cdd0f7', color: '#2a2a4a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0,
        }}
      >
        AA
      </Box>
      <Typography sx={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: 500 }} noWrap>Assaf A.</Typography>
      <IconButton size="small" aria-label="Settings" disabled sx={{ color: colors.textMuted }}>
        <SettingsIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
```

- [ ] **Step 3: Rewrite `Layout.tsx`**

```tsx
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import InsightsIcon from '@mui/icons-material/Insights';
import DnsIcon from '@mui/icons-material/Dns';
import HubIcon from '@mui/icons-material/Hub';
import { useNavigate, useLocation } from 'react-router-dom';
import { colors } from './dashboard/palette.js';
import { WorkspaceChip } from './WorkspaceChip.js';
import { SidebarAccount } from './SidebarAccount.js';

const DRAWER_WIDTH = 240;
const NAV = [
  { label: 'Agents', path: '/', icon: <SmartToyIcon fontSize="small" /> },
  { label: 'Activity', path: '/runs', icon: <InsightsIcon fontSize="small" /> },
  { label: 'Runners', path: '/runners', icon: <DnsIcon fontSize="small" /> },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: colors.pageBg }}>
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH, flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH, boxSizing: 'border-box',
            bgcolor: colors.card, borderRight: `1px solid ${colors.cardBorder}`,
            display: 'flex', flexDirection: 'column',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 2 }}>
          <Box
            sx={{
              width: 32, height: 32, borderRadius: 2, bgcolor: 'primary.main', color: '#10131c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <HubIcon fontSize="small" />
          </Box>
          <Typography sx={{ fontSize: 18, fontWeight: 700, color: colors.text }}>Agent hub</Typography>
        </Box>

        <WorkspaceChip />

        <List sx={{ flex: 1, px: 1 }}>
          {NAV.map((n) => {
            const selected = pathname === n.path;
            return (
              <ListItemButton
                key={n.path}
                selected={selected}
                onClick={() => navigate(n.path)}
                sx={{
                  borderRadius: 2, mb: 0.5, pl: 1.5,
                  borderLeft: '3px solid transparent',
                  '&.Mui-selected': { bgcolor: 'rgba(137,180,250,0.14)', borderLeftColor: 'primary.main' },
                  '&.Mui-selected:hover': { bgcolor: 'rgba(137,180,250,0.20)' },
                }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: selected ? 'primary.main' : colors.textMuted }}>
                  {n.icon}
                </ListItemIcon>
                <ListItemText
                  primary={n.label}
                  primaryTypographyProps={{
                    fontSize: 14,
                    fontWeight: selected ? 600 : 500,
                    color: selected ? colors.text : colors.textMuted,
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>

        <SidebarAccount />
      </Drawer>

      <Box component="main" sx={{ flex: 1, p: 3, bgcolor: colors.pageBg, minHeight: '100vh' }}>
        {children}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc -p .` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/WorkspaceChip.tsx apps/client/src/components/SidebarAccount.tsx apps/client/src/components/Layout.tsx
git commit -m "feat(client): rebuild sidebar with icons, workspace chip, account block"
```

---

## Task 5: Agents page + card redesign

**Files:**
- Modify: `apps/client/src/components/AgentCard.tsx` (restructure content, status, actions)
- Modify: `apps/client/src/components/SortableAgentCard.tsx` (forward `model`)
- Modify: `apps/client/src/pages/AgentsPage.tsx` (grid, search, filter, build models)

**Interfaces:**
- Consumes: `buildAgentCardModels`, `AgentCardModel`, `matchesStatusFilter`, `isRunningState`, `summarizeTrigger`, `StatusFilter` from `lib/cardView.ts`; `relativeTime` from `lib/dashboard.ts`; `useRuns` from `hooks/useRuns.ts`; `StatusPill`, `Sparkline` components.
- Produces: `AgentCard` now accepts a `model?: AgentCardModel` prop; `SortableAgentCard` accepts and forwards `model`.

- [ ] **Step 1: Rewrite `AgentCard.tsx`**

```tsx
import { useState } from 'react';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { useNavigate } from 'react-router-dom';
import { type Agent } from '../api/client.js';
import { useTriggerRun, useArchiveAgent, useDeleteAgent } from '../hooks/useAgents.js';
import { AgentAvatar } from './AgentAvatar.js';
import { StatusPill } from './StatusPill.js';
import { Sparkline } from './Sparkline.js';
import { summarizeTrigger, isRunningState, type AgentCardModel } from '../lib/cardView.js';
import { relativeTime } from '../lib/dashboard.js';

interface Props {
  agent: Agent;
  onEdit: (id: string) => void;
  model?: AgentCardModel;
  dragHandleProps?: React.HTMLAttributes<HTMLElement> & { ref?: (el: HTMLElement | null) => void };
}

const MAX_VISIBLE_SKILLS = 4;

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, color: accent }} noWrap>{value}</Typography>
    </Box>
  );
}

export function AgentCard({ agent, onEdit, model, dragHandleProps }: Props) {
  const trigger = useTriggerRun();
  const archive = useArchiveAgent();
  const del = useDeleteAgent();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
    try { return JSON.parse(raw || '') as T; } catch { return fallback; }
  };
  const repos = parse<string[]>(agent.repos, []);
  const skills = parse<string[]>(agent.skills, []);
  const visibleSkills = skills.slice(0, MAX_VISIBLE_SKILLS);
  const overflow = skills.length - visibleSkills.length;

  const health = model?.health;
  const running = model ? isRunningState(model.state) : false;
  const successText = health && health.successRate !== null ? `${Math.round(health.successRate * 100)}%` : '—';
  const lastText = health && health.lastRunAt ? relativeTime(health.lastRunAt) : '—';
  const trig = summarizeTrigger(agent.triggerRules);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: agent.archived ? 0.55 : 1 }}>
      <CardActionArea onClick={() => navigate(`/agents/${agent.id}`)}>
        <CardContent>
          <Box display="flex" gap={1} alignItems="center">
            {dragHandleProps && (
              <Box
                {...dragHandleProps}
                onClick={(e) => e.stopPropagation()}
                sx={{ cursor: 'grab', display: 'flex', color: 'text.disabled', touchAction: 'none' }}
                aria-label="Drag to reorder"
              >
                <DragIndicatorIcon fontSize="small" />
              </Box>
            )}
            <AgentAvatar avatarKey={agent.avatarKey} name={agent.name} size={48} />
            <Box flex={1} minWidth={0}>
              <Typography variant="h6" noWrap>{agent.name}</Typography>
              {agent.title && (
                <Typography variant="body2" color="text.secondary" noWrap>{agent.title}</Typography>
              )}
            </Box>
            {agent.archived ? (
              <Chip label="archived" color="warning" size="small" />
            ) : model ? (
              <StatusPill state={model.state} />
            ) : (
              <Chip label={agent.enabled ? 'active' : 'paused'} color={agent.enabled ? 'success' : 'default'} size="small" />
            )}
          </Box>

          <Typography variant="body2" color="text.secondary" mt={1} noWrap>
            {agent.model} · {trig}
          </Typography>

          {visibleSkills.length > 0 && (
            <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
              {visibleSkills.map((s) => (
                <Chip key={s} label={s} size="small" color="primary" variant="outlined" />
              ))}
              {overflow > 0 && <Chip label={`+${overflow}`} size="small" />}
            </Stack>
          )}

          {model && (
            <>
              <Box display="flex" justifyContent="space-between" gap={1} mt={1.5}>
                <Metric label="Runs" value={String(health?.total ?? 0)} />
                <Metric label="Success" value={successText} accent={successText !== '—' ? '#4ade80' : undefined} />
                <Metric label="Last" value={lastText} />
              </Box>
              <Box mt={1}>
                <Sparkline markers={model.markers} />
              </Box>
            </>
          )}

          <Typography variant="body2" color="text.secondary" mt={1.5} noWrap>
            {repos.join(', ') || 'No repos configured'}
          </Typography>
        </CardContent>
      </CardActionArea>
      <CardActions sx={{ mt: 'auto' }}>
        {agent.archived ? (
          <>
            <Tooltip title="Unarchive">
              <IconButton
                size="small" aria-label="Unarchive agent"
                onClick={() => archive.mutate({ id: agent.id, archived: false })}
                disabled={archive.isPending}
              >
                <UnarchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete permanently">
              <IconButton
                size="small" color="error" aria-label="Delete agent permanently"
                onClick={() => setConfirmOpen(true)}
              >
                <DeleteForeverIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Button size="small" onClick={() => onEdit(agent.id)}>Edit</Button>
            {running && model?.latest ? (
              <Button
                size="small" variant="contained"
                onClick={() => navigate(`/runs/${model.latest!.id}`)}
              >
                View run
              </Button>
            ) : (
              <Button
                size="small" variant="contained" startIcon={<PlayArrowIcon />}
                onClick={() => trigger.mutate(agent.id, { onSuccess: (run) => navigate(`/runs/${run.id}`) })}
                disabled={trigger.isPending}
              >
                Run
              </Button>
            )}
            <Tooltip title="Archive">
              <IconButton
                size="small" sx={{ ml: 'auto' }} aria-label="Archive agent"
                onClick={() => archive.mutate({ id: agent.id, archived: true })}
                disabled={archive.isPending}
              >
                <ArchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </CardActions>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete "{agent.name}" permanently?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes the agent and cannot be undone. Archived agents can be restored instead.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            disabled={del.isPending}
            onClick={() => del.mutate(agent.id, { onSuccess: () => setConfirmOpen(false) })}
          >
            Delete permanently
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 2: Update `SortableAgentCard.tsx` to forward `model`**

```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type Agent } from '../api/client.js';
import { AgentCard } from './AgentCard.js';
import { type AgentCardModel } from '../lib/cardView.js';

interface Props { agent: Agent; onEdit: (id: string) => void; model?: AgentCardModel; }

export function SortableAgentCard({ agent, onEdit, model }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: agent.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <AgentCard
        agent={agent}
        onEdit={onEdit}
        model={model}
        dragHandleProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `AgentsPage.tsx`**

```tsx
import { useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import SearchIcon from '@mui/icons-material/Search';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useNavigate } from 'react-router-dom';
import { useAgents, useReorderAgents } from '../hooks/useAgents.js';
import { useRuns } from '../hooks/useRuns.js';
import { computeReorder } from '../lib/reorder.js';
import { buildAgentCardModels, matchesStatusFilter, type StatusFilter } from '../lib/cardView.js';
import { AgentCard } from '../components/AgentCard.js';
import { SortableAgentCard } from '../components/SortableAgentCard.js';

const GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
  gap: 2,
} as const;

export function AgentsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const { data: agents, isLoading, isError } = useAgents(showArchived);
  const { data: runs } = useRuns();
  const reorder = useReorderAgents();
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const all = useMemo(() => agents ?? [], [agents]);
  const models = useMemo(() => buildAgentCardModels(all, runs ?? []), [all, runs]);

  if (isLoading) return <CircularProgress />;
  if (isError) return <Typography color="error">Failed to load agents. Is the server running?</Typography>;

  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);

  const matchesSearch = (name: string) => name.toLowerCase().includes(search.trim().toLowerCase());
  const visibleActive = active.filter((a) => {
    const state = models.get(a.id)?.state ?? 'idle';
    return matchesSearch(a.name) && matchesStatusFilter(state, status);
  });
  const activeIds = visibleActive.map((a) => a.id);

  const onEdit = (id: string) => navigate(`/agents/${id}/edit`);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    // reorder over the full visible (unfiltered) active list to keep ordering stable
    const fullIds = active.map((a) => a.id);
    const next = computeReorder(fullIds, String(dragged.id), String(over.id));
    reorder.mutate(next);
  };

  const dndDisabled = search.trim() !== '' || status !== 'all';

  return (
    <>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography variant="h5">Agents</Typography>
        <Typography variant="body2" color="text.secondary" flex={1}>
          · {active.length} active
        </Typography>
        <FormControlLabel
          control={<Switch size="small" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
          label="Show archived"
        />
        <Button variant="contained" onClick={() => navigate('/agents/new')}>New agent</Button>
      </Box>

      <Box display="flex" gap={2} mb={2} alignItems="center" flexWrap="wrap">
        <TextField
          size="small"
          placeholder="Search agents"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={status}
          onChange={(_, v) => v && setStatus(v as StatusFilter)}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="running">Running</ToggleButton>
          <ToggleButton value="idle">Idle</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={activeIds} strategy={rectSortingStrategy} disabled={dndDisabled}>
          <Box sx={GRID_SX}>
            {visibleActive.map((a) => (
              <SortableAgentCard key={a.id} agent={a} onEdit={onEdit} model={models.get(a.id)} />
            ))}
          </Box>
        </SortableContext>
      </DndContext>

      {active.length > 0 && visibleActive.length === 0 && (
        <Typography color="text.secondary">No agents match your search.</Typography>
      )}

      {showArchived && archived.length > 0 && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 3, mb: 1 }}>Archived</Typography>
          <Box sx={GRID_SX}>
            {archived.map((a) => (
              <AgentCard key={a.id} agent={a} onEdit={onEdit} model={models.get(a.id)} />
            ))}
          </Box>
        </>
      )}

      {all.length === 0 && (
        <Typography color="text.secondary">No agents yet. Create one to get started.</Typography>
      )}
    </>
  );
}
```

Note on DnD: when a search/status filter is active, sorting is disabled (`dndDisabled`) so a partial list can't corrupt the persisted order. With no filter, reorder operates over the full active id list.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc -p .` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 5: Run unit tests (ensure reused helpers still green)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/AgentCard.tsx apps/client/src/components/SortableAgentCard.tsx apps/client/src/pages/AgentsPage.tsx
git commit -m "feat(client): redesign agents grid and cards with live stats and filters"
```

---

## Task 6: Activity page polish (stat cards, pipeline icons, header)

**Files:**
- Modify: `apps/client/src/components/dashboard/StatCards.tsx` (use shared `StatCard`)
- Modify: `apps/client/src/components/dashboard/PipelineStrip.tsx` (real icons)
- Modify: `apps/client/src/pages/MonitoringDashboard.tsx` (title "Activity", drop `m:-3`)
- Verify only (no change): `apps/client/src/components/dashboard/ActivityList.tsx`

**Interfaces:**
- Consumes: `StatCard` from `components/StatCard.tsx`; MUI icons `ViewKanbanIcon`, `BuildIcon`, `RateReviewIcon`, `CallMergeIcon`.
- `StatCards` keeps its existing props `{ stats: DashboardStats; queuedTasks: number }`.

- [ ] **Step 1: Rewrite `StatCards.tsx` to use the shared card**

```tsx
import Box from '@mui/material/Box';
import { StatCard } from '../StatCard.js';
import type { DashboardStats } from '../../lib/dashboard.js';

export function StatCards({ stats, queuedTasks }: { stats: DashboardStats; queuedTasks: number }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
        mb: 2,
      }}
    >
      <StatCard label="Active agents" value={stats.activeAgents} />
      <StatCard label="Tasks queued" value={queuedTasks} />
      <StatCard label="MRs today" value={stats.mrsToday} />
      <StatCard label="Avg cycle" value={stats.avgCycle} />
    </Box>
  );
}
```

- [ ] **Step 2: Rewrite `PipelineStrip.tsx` with real icons**

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import BuildIcon from '@mui/icons-material/Build';
import RateReviewIcon from '@mui/icons-material/RateReview';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SvgIconComponent } from '@mui/icons-material';
import { colors } from './palette.js';

const STAGES: { label: string; color: string; Icon: SvgIconComponent }[] = [
  { label: 'Jira backlog', color: 'rgba(255,255,255,0.45)', Icon: ViewKanbanIcon },
  { label: 'Build MR', color: 'rgba(255,255,255,0.45)', Icon: BuildIcon },
  { label: 'Review', color: '#e6b65c', Icon: RateReviewIcon },
  { label: 'Merge', color: '#4ade80', Icon: CallMergeIcon },
];

function Node({ color, Icon }: { color: string; Icon: SvgIconComponent }) {
  return (
    <Box
      sx={{
        width: 40, height: 40, borderRadius: 2,
        border: `2px solid ${color}`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon sx={{ fontSize: 22 }} />
    </Box>
  );
}

export function PipelineStrip() {
  return (
    <Box sx={{ bgcolor: colors.card, border: `1px solid ${colors.cardBorder}`, borderRadius: 3, p: 3, mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around', gap: 1, overflowX: 'auto' }}>
        {STAGES.map((stage, i) => (
          <Box key={stage.label} sx={{ display: 'contents' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, minWidth: 90 }}>
              <Node color={stage.color} Icon={stage.Icon} />
              <Typography sx={{ color: colors.text, fontSize: 15, fontWeight: 500 }}>{stage.label}</Typography>
            </Box>
            {i < STAGES.length - 1 && (
              <ChevronRightIcon sx={{ color: colors.divider, mt: '8px', fontSize: 22 }} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Update `MonitoringDashboard.tsx` header + drop the `m:-3` bleed**

Replace the three `Box sx={{ bgcolor: colors.pageBg, m: -3, p: ... }}` wrappers (loading, error, and main return) so the page no longer fights the Layout padding (the Layout now owns `pageBg`), and change the header text. Concretely:

- Loading branch: `return <CircularProgress sx={{ mt: 2 }} />;`
- Error branch: `return <Typography color="error">Failed to load. Is the server running?</Typography>;`
- Main return: replace the outer wrapper `<Box sx={{ bgcolor: colors.pageBg, m: -3, p: { xs: 2.5, md: 4 }, minHeight: '100vh' }}>` with a plain `<Box>` (no bg, no negative margin; Layout supplies padding + background).
- Header block: change the title `Typography` from "Agent hub" to **"Activity"** and **remove** the "Global-E · CORE workspace" subtitle line (that identity now lives in the sidebar). Keep the right-side "N agents live" indicator.

Resulting main return:

```tsx
  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 3.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ color: colors.text, fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>
            Activity
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: colors.live }} />
          <Typography sx={{ color: colors.textMuted, fontSize: 16 }}>
            {stats.liveCount} agents live
          </Typography>
        </Box>
      </Box>

      <StatCards stats={stats} queuedTasks={stats.tasksQueued} />
      <OrchestratorCard assigned={stats.activeAgents} inProgress={inProgress} queued={stats.tasksQueued} />
      <PipelineStrip />
      <WorkerGrid cards={cards} />
      <ActivityList runs={feed} agentsById={agentsById} />
    </Box>
  );
```

(`colors` is still imported for `colors.text`, `colors.textMuted`, `colors.live`.)

- [ ] **Step 4: Verify `ActivityList.tsx` is already correct (no change)**

Open `apps/client/src/components/dashboard/ActivityList.tsx` and confirm it already renders a leading colored marker (`runMarker[run.status]`) and `relativeTime(when)`. **No edit needed** — this satisfies the spec's "leading icons + relative times" for the activity list. Do not modify it.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc -p .` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/components/dashboard/StatCards.tsx apps/client/src/components/dashboard/PipelineStrip.tsx apps/client/src/pages/MonitoringDashboard.tsx
git commit -m "feat(client): tighten activity stat cards, add pipeline icons, rename header"
```

---

## Task 7: Runners page (honest frontend-only)

**Files:**
- Create: `apps/client/src/components/RunnerConnectDialog.tsx`
- Modify: `apps/client/src/pages/RunnersPage.tsx` (full rewrite)

**Interfaces:**
- Consumes: `runnerStats` from `lib/runners.ts`; `relativeTime` from `lib/dashboard.ts`; `StatCard` component; `Runner` from `api/client.ts`.
- Produces: `<RunnerConnectDialog open onClose />`.

- [ ] **Step 1: Create `RunnerConnectDialog.tsx`**

```tsx
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';

export function RunnerConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect a runner</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Runners register themselves with the hub when they start and send a heartbeat.
          Start a runner on the target machine and it will appear here automatically:
        </DialogContentText>
        <Box
          component="pre"
          sx={{
            bgcolor: 'rgba(255,255,255,0.05)', border: '1px solid', borderColor: 'divider',
            borderRadius: 1.5, p: 2, m: 0, fontSize: 13, overflowX: 'auto',
          }}
        >
{`# from the agent-hub repo root
npm run dev:runner`}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Rewrite `RunnersPage.tsx`**

```tsx
import { useState } from 'react';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { runnerStats } from '../lib/runners.js';
import { relativeTime } from '../lib/dashboard.js';
import { StatCard } from '../components/StatCard.js';
import { RunnerConnectDialog } from '../components/RunnerConnectDialog.js';

export function RunnersPage() {
  const { data: runners, isError } = useQuery({ queryKey: ['runners'], queryFn: api.runners.list, refetchInterval: 10000 });
  const [dialogOpen, setDialogOpen] = useState(false);

  const list = runners ?? [];
  const stats = runnerStats(list);

  return (
    <>
      <Box display="flex" alignItems="center" gap={1.5} mb={2}>
        <Typography variant="h5">Runners</Typography>
        <Typography variant="body2" color="text.secondary" flex={1}>· {stats.total} total</Typography>
        <Button variant="contained" onClick={() => setDialogOpen(true)}>Add runner</Button>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(2, minmax(0, 220px))' }, mb: 3 }}>
        <StatCard label="Online" value={stats.online} accent="#4ade80" />
        <StatCard label="Total" value={stats.total} />
      </Box>

      {isError ? (
        <Typography color="error">Failed to load runners. Is the server running?</Typography>
      ) : list.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, border: '1px dashed', borderColor: 'divider', borderRadius: 3 }}>
          <Typography color="text.secondary" mb={2}>No runners connected.</Typography>
          <Button variant="contained" onClick={() => setDialogOpen(true)}>Add runner</Button>
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell align="right">Last seen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map((r) => {
              const online = r.status === 'online';
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: online ? '#4ade80' : 'text.disabled' }} />
                      {r.name}
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={new Date(r.lastSeen).toLocaleString()}>
                      <span>{relativeTime(r.lastSeen)}</span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <RunnerConnectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc -p .` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all lib tests including `runners.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/RunnerConnectDialog.tsx apps/client/src/pages/RunnersPage.tsx
git commit -m "feat(client): redesign runners page with stat strip, status dots, connect dialog"
```

---

## Final verification (after all tasks)

- [ ] Run `npx vitest run` from `apps/client` → all tests pass.
- [ ] Run `npm run build` from `apps/client` → clean build.
- [ ] (Manual, optional) Start the app and click through Agents / Activity / Runners: sidebar shows icons + active accent bar + account block; agent cards show stats + sparkline + status pill; activity pipeline shows icons; runners show stat strip + status dots + relative times + working "Add runner" dialog and empty state.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Foundation/theme → Task 1. ✓
- Sidebar (mark, wordmark casing, workspace chip, icon nav, accent-bar active, account block) → Task 4. ✓
- Agents grid (`auto-fill minmax(360px,1fr)`), search + Running/Idle filter, card (status pill, model·trigger meta, skill-only chips, Runs/Success/Last, sparkline, View-run) → Tasks 2 (logic) + 5 (UI). ✓
- Activity (tighter stat cards, pipeline icons, title "Activity", drop `m:-3`, activity-list icons+relative already present) → Task 6. ✓
- Runners (count, Add-runner connect dialog, Online/Total strip, status dot + relative last-seen, empty + error states, no Platform/Version/Jobs/Capacity) → Tasks 2 (logic) + 7 (UI). ✓
- Shared primitives (StatusPill, Sparkline, StatCard) → Task 3. ✓
- `recentRunMarkers` (n=10), `relativeTime`/`computeAgentHealth`/`buildWorkerCards` reuse → Task 2. ✓
- Constraints: no new deps (only `@mui/*` imports used), no backend changes, node-env pure tests only → enforced throughout; UI gated by `tsc`/`build`. ✓

**Placeholder scan:** No TODO/TBD/"handle errors"-style placeholders; every code step has complete code.

**Type consistency:** `AgentCardModel` (`health`/`state`/`markers`/`latest`) is defined in Task 2 and consumed identically in Tasks 5 (`AgentCard`, `SortableAgentCard`, `AgentsPage`). `recentRunMarkers(runs, agentId, n)` signature is consistent across definition (Task 2) and use (`buildAgentCardModels`, `Sparkline count`). `runnerStats` returns `{online,total}` used verbatim in Task 7. `StatCard` props `{label,value,accent?}` consistent across Tasks 3, 6, 7. `summarizeTrigger`/`matchesStatusFilter`/`isRunningState` signatures consistent between Task 2 and Task 5.

**Note on a spec deviation (intentional, documented):** the spec's Testing section mentioned "Vitest + Testing Library"; the client has no Testing Library and runs vitest in `node`, and the no-new-deps constraint forbids adding it. The plan therefore tests pure logic only and verifies UI via typecheck/build — matching the repo's actual established test pattern. All testable behavior was pushed into pure helpers to preserve coverage.
