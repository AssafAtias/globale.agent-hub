# UI Redesign — App Shell, Agents, Activity, Runners — Design

**Date:** 2026-06-25
**Repo:** `globale.agent-hub` (client only — `apps/client`)
**Scope:** Visual + density redesign of the three screens and the app shell, to a user-supplied mockup. Frontend-only, no new dependencies, no backend/API changes.

## Problem

The app reads as unfinished. Across all three screens, content floats at the top and the lower portion of the viewport is empty dark space, which signals "ran out of things to show" rather than an intentional layout. Specifically:

1. **Shell ([Layout.tsx](../../../apps/client/src/components/Layout.tsx)):** the sidebar is three bare text links — no icons, a weak active state, no workspace identity at the top, and nothing anchoring the bottom. The wordmark casing ("Agent Hub") disagrees with the page heading ("Agent hub").
2. **Agents ([AgentsPage.tsx](../../../apps/client/src/pages/AgentsPage.tsx), [AgentCard.tsx](../../../apps/client/src/components/AgentCard.tsx)):** a fixed 2-column grid leaves two wide cards over a void. Cards state *what* an agent is but nothing about *how it is doing* (no run count, success rate, recency, or live state). The tag row mixes trigger, model, and capabilities. No search/filter.
3. **Activity ([MonitoringDashboard.tsx](../../../apps/client/src/pages/MonitoringDashboard.tsx)):** metric cards are taller than needed; the pipeline strip draws empty placeholder squares ([PipelineStrip.tsx:12-13](../../../apps/client/src/components/dashboard/PipelineStrip.tsx#L12-L13)) instead of real icons; the page duplicates the "Agent hub / Global-E · CORE workspace" branding that will move into the sidebar.
4. **Runners ([RunnersPage.tsx](../../../apps/client/src/pages/RunnersPage.tsx)):** a 3-column table (Name / Status / Last Seen) with absolute timestamps. Thin and broken-looking, no header stats, no empty state, no CTA.

A consistent surface-elevation system (page bg → card surface → 1px border) exists only for the dashboard ([dashboard/palette.ts](../../../apps/client/src/components/dashboard/palette.ts)); the other screens use raw MUI defaults, so their card-vs-background contrast is low.

## Scope

- Promote the dashboard's local palette into the shared MUI theme so all screens share one elevation system and status-color vocabulary.
- Rebuild the sidebar: app mark + wordmark, static workspace chip, icon nav with a strong active state, pinned bottom account block.
- Agents: responsive tile grid, search + status-filter, and a richer card (live-status pill, model·trigger meta line, capability-only chips, Runs/Success/Last stats row, recent-runs sparkline).
- Activity: tighten stat cards, replace pipeline placeholder squares with real icons, leading icons + relative times in the activity list, drop the now-duplicate page branding.
- Runners: header with count + "Add runner" (connect-instructions dialog), an **Online / Total** stat strip, status dot + relative last-seen table, and an empty state.
- Reuse existing derivations (`computeAgentHealth`, `relativeTime`, `buildWorkerCards`/`stateFor`, `runMarker`, `stateStyles`) rather than re-deriving.

## Non-goals

- **No backend, API, runner, or DB changes.** The `Runner` model stays `{id, name, status, lastSeen}`.
- **No new npm dependencies.** Icons come from the already-installed `@mui/icons-material`. (The originating critique suggested `lucide-react`; that was based on pasted Tabler-class HTML, not this stack. The empty pipeline squares are hand-drawn `<Box>` elements, not a missing webfont.)
- **No richer Runners columns** (Platform / Version / Jobs / Capacity) and **no Capacity / Jobs-running stat cards** — there is no data behind them, and inventing values would be dishonest. This screen intentionally diverges from the supplied mockup. (User decision: "Trim Runners to honest frontend-only.")
- **No working multi-workspace switcher and no auth/account system.** The workspace chip and account block are static display only.
- No changes to agent create/edit, run detail, drag-to-reorder, or archive flows beyond restyling.

## Key Decisions

- **Single token source.** [dashboard/palette.ts](../../../apps/client/src/components/dashboard/palette.ts) becomes the canonical design-token module (its header comment "kept local so other pages are unaffected" is now obsolete — we *want* them affected). The MUI theme in [theme.ts](../../../apps/client/src/theme.ts) is wired from these tokens (`background.default = pageBg`, `background.paper = card`, divider/border, `success`/`warning`/`info` aligned to the status colors). Components keep reading `colors`/`stateStyles`/`runMarker` from palette; nothing needs a parallel token list.
- **Reuse existing derivations — add almost no new logic.**
  - Agent card numbers come from the existing `computeAgentHealth` ([runStats.ts:28](../../../apps/client/src/lib/runStats.ts#L28)): `total` → Runs, `successRate` → Success%, `lastRunAt` → Last (via existing `relativeTime`), `lastStatus`/`running` → live state.
  - Live-status pill reuses `stateFor`/`buildWorkerCards` ([dashboard.ts:77-99](../../../apps/client/src/lib/dashboard.ts#L77-L99)) and `stateStyles` ([palette.ts:17](../../../apps/client/src/components/dashboard/palette.ts#L17)) so the Agents pill and the dashboard worker pill are visually identical.
  - **Only new pure helper:** `recentRunMarkers(runs, agentId, n)` in [runStats.ts](../../../apps/client/src/lib/runStats.ts) — returns the last `n` non-archived run statuses (oldest→newest) for the sparkline, colored via the existing `runMarker` map.
  - `relativeTime` ([dashboard.ts:30](../../../apps/client/src/lib/dashboard.ts#L30)) is reused everywhere a relative timestamp appears (cards, activity list, runners). **No new time util.**
- **Branding lives in the sidebar, not the page.** Because the shell now carries "Agent hub" + the workspace chip, the Activity page header changes from "Agent hub / Global-E · CORE workspace" to **"Activity"** + the existing "N agents live" indicator. Removes duplication.
- **Drop the `m: -3` page-bleed hack.** Once `background.default = pageBg` is set on the theme (and the Layout main area uses the page bg), [MonitoringDashboard.tsx:40,46,52](../../../apps/client/src/pages/MonitoringDashboard.tsx#L52) no longer needs `m: -3` to escape Layout padding. The Layout owns the page background for all routes.
- **"Add runner" is honest.** Runners self-register through their heartbeat (which sets `lastSeen`); there is no create endpoint. The CTA opens a dialog showing the command/steps to connect a new runner — not a form that would POST nowhere.
- **Status vocabulary is shared.** One `StatusPill` and one status-dot style are used by Agents cards, the dashboard, and Runners, all driven by `stateStyles`/status colors, so "online", "Running", "Idle", "Failed" look consistent across screens.

## Theme & Tokens

### [theme.ts](../../../apps/client/src/theme.ts)

Wire the MUI theme from `palette.ts` tokens:

- `palette.background.default = colors.pageBg`, `palette.background.paper = colors.card`.
- `palette.divider = colors.cardBorder`.
- `palette.text.primary = colors.text`, `text.secondary = colors.textMuted`.
- Map status intents: `success.main = '#4ade80'`, `warning.main = '#e6b65c'`, `error.main = '#f0706f'`, `info.main`/`primary` keep the accent (`#89b4fa` / `#5b9bff`).
- `components.MuiCard`/`MuiPaper` default override: `backgroundColor: colors.card`, `border: 1px solid colors.cardBorder`, consistent `borderRadius`, `backgroundImage: 'none'` (kills MUI's default dark elevation overlay so the surface tier is exactly one step above the page).
- Keep `palette.ts` as the literal token values; the theme references them so there is one source of truth.

## App Shell — [Layout.tsx](../../../apps/client/src/components/Layout.tsx)

Rebuild the permanent `Drawer` to a three-region flex column (`height: 100vh`): header / nav (flex:1) / footer.

- **Header:** an accent rounded square containing an app icon (e.g. `HubIcon`/`AutoAwesomeIcon`) + the wordmark **"Agent hub"** (single canonical casing). Below it, a **workspace chip** — a bordered, full-width row "Global-E · CORE" with a trailing `UnfoldMoreIcon`/`ExpandMoreIcon` chevron. Static (renders a constant); built as its own small component (`WorkspaceChip`) so a real switcher can replace it later. No menu opens on click for now (or a disabled/no-op affordance).
- **Nav:** the `NAV` array gains an `icon` per item — Agents (`SmartToyIcon` or `GroupsIcon`), Activity (`InsightsIcon`/`TimelineIcon`), Runners (`DnsIcon`/`MemoryIcon`). Each `ListItemButton` gets a `ListItemIcon` + label. **Active state:** tinted background (`rgba` of accent) **plus a left accent bar** (`borderLeft: 3px solid primary` or a `::before`), not just MUI's faint `selected`. Active selection still keyed on `pathname === n.path`.
- **Footer (pinned, `mt: auto`):** a top divider, then an account block — `AgentAvatar`-style circular initials "AA" (or a plain MUI `Avatar`), name **"Assaf A."**, and a `SettingsIcon` button. Static display; the gear is a placeholder with no action. Built as `SidebarAccount` component.
- **Main area:** keeps `flex: 1`; background = `background.default` (page bg). Remove the dashboard's need to bleed past padding by giving the dashboard route the same padded container as the others (see Activity).

New small components (all in `apps/client/src/components/`, no new deps): `WorkspaceChip`, `SidebarAccount`. `NAV` extended with `icon`.

## Agents — [AgentsPage.tsx](../../../apps/client/src/pages/AgentsPage.tsx) + [AgentCard.tsx](../../../apps/client/src/components/AgentCard.tsx)

### Page

- **Header:** "Agents" + a muted "· N active" count next to it; "New agent" button on the right (keep wording consistent — mockup says "New agent"). Keep the existing "Show archived" switch.
- **Toolbar row (new):** a search `TextField` (filter by `name`, case-insensitive substring) + a `ToggleButtonGroup` of status pills **All / Running / Idle** (and the toolbar can later host more filters). Filtering is pure client-side over the already-loaded agents + their derived live state.
- **Grid:** replace `GRID_SX` fixed `{ xs: '1fr', sm: '1fr 1fr' }` with `gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))'` so cards tile and a third/fourth fills the row as agents are added. Drag-to-reorder (`DndContext`/`SortableContext` with `rectSortingStrategy`) is preserved; `rectSortingStrategy` already suits a wrapping grid.
- **Live status + stats source:** the page (or a small hook) computes `computeAgentHealth(runs, agents)` and `buildWorkerCards(agents, runs)` once from `useRuns()` + `useAgents()`, and passes each agent its `AgentHealth` + `WorkerState` + sparkline markers as props. (Cards stay presentational; no per-card fetching.) The status filter reads the derived `WorkerState`.

### Card

Restructured to the mockup, top to bottom:

1. **Top row:** drag handle (unchanged, non-archived only) + `AgentAvatar` + name (+ optional `title`) + **`StatusPill`** on the right showing live state (Running / Idle / Failed / Queued) from `WorkerState`, replacing today's static enabled/paused/archived chip. (Archived still forces a dimmed "archived" presentation.)
2. **Meta line (new):** a single muted line `「{model} · {trigger}」`, e.g. "Sonnet 4.6 · on Jira label", where trigger is summarized from `triggerRules` (events / jiraLabel). Replaces putting `type` and `model` as chips.
3. **Capability chips:** `skills` **only** (capped at `MAX_VISIBLE_SKILLS` with `+N` overflow, as today). `type` and `model` are no longer chips (they moved to the meta line).
4. **Stats row (new):** three inline stats — **Runs** (`health.total`), **Success** (`Math.round(successRate*100)%`, green; "—" when null), **Last** (`relativeTime(lastRunAt)`; "—" when null).
5. **Sparkline (new):** a thin row of `n` (≈8–12) small bars colored by `runMarker[status]` from `recentRunMarkers(runs, agentId, n)`; empty/neutral when no runs. Implemented as a tiny `Sparkline` component (plain `<Box>` bars, no charting lib).
6. **Actions:** Edit + Run as today; when the agent's live state is running, the primary action reads **"View run"** and navigates to the active run instead of triggering a new one. Archive/unarchive/delete actions unchanged.

New components: `StatusPill`, `Sparkline` (both in `apps/client/src/components/`). `AgentCard` props extended with `health`, `state`, `markers` (or a single derived `view` object).

## Activity — [MonitoringDashboard.tsx](../../../apps/client/src/pages/MonitoringDashboard.tsx) + dashboard components

Largely restyle; the data layer is unchanged.

- **Header:** change title from "Agent hub" + "Global-E · CORE workspace" to **"Activity"** (h5-equivalent) and keep the existing "N agents live" indicator on the right. Remove `m: -3`; rely on the Layout-owned page background and standard padding.
- **Stat cards ([StatCards.tsx](../../../apps/client/src/components/dashboard/StatCards.tsx)):** reduce internal padding (`p: 2.5 → ~1.75`) and value font (`40 → ~30`) so the cards are tighter; keep the 4 metrics (Active / Queued / MRs today / Avg cycle) and the responsive `2-up → 4-up` grid.
- **Pipeline strip ([PipelineStrip.tsx](../../../apps/client/src/components/dashboard/PipelineStrip.tsx)):** replace the empty placeholder `<Box>` `Node`/`Connector` squares with **MUI icons** per stage — Jira backlog (`ViewKanbanIcon`/`AssignmentIcon`), Build MR (`BuildIcon`/`MergeIcon`), Review (`RateReviewIcon`), Merge (`CallMergeIcon`/`DoneAllIcon`) — keeping the existing stage colors and connecting them with a thin line/chevron instead of a bordered square.
- **Recent activity ([ActivityList.tsx](../../../apps/client/src/components/dashboard/ActivityList.tsx)):** add a **leading status icon** per row (colored by run status via `runMarker`) and ensure timestamps render through `relativeTime` (matching "2m / 5m / 18m"). Hover shows the exact time (`title`/`Tooltip`).
- `OrchestratorCard` and `WorkerGrid`: align to the shared card surface (they already use `colors.*`; verify they pick up the unified tokens, no structural change).

## Runners — [RunnersPage.tsx](../../../apps/client/src/pages/RunnersPage.tsx)

Honest, frontend-only — intentionally simpler than the mockup.

- **Header:** "Runners" + muted "· N total"; **"Add runner"** button on the right → opens a `Dialog` titled "Connect a runner" containing the shell command / steps to start a runner that self-registers (static instructional content; no form submit).
- **Stat strip (new):** two `StatCard`s — **Online** (`runners.filter(status === 'online').length`) and **Total** (`runners.length`). **Capacity and Jobs-running are deliberately omitted** (no data).
- **Table:** keep MUI `Table size="small"`. Columns: **Name** (with a leading status dot — green online / grey otherwise, matching the shared status-dot style) and **Last seen** (relative via `relativeTime`, exact time on hover via `Tooltip`). **Platform / Version / Jobs columns are omitted.** Keep a `Status` chip if desired, or fold status into the dot + remove the redundant column; final: status dot on the name + "Last seen" — two meaningful columns rather than three thin ones, plus the stat strip carries the at-a-glance counts.
- **Empty state:** when `runners.length === 0`, render a centered message + the same "Add runner" CTA, instead of an empty table.

New usage: `StatCard` (shared, see below). A small `RunnerConnectDialog` (static content) co-located with the page.

## Shared Components & Helpers (new, small, reused)

In `apps/client/src/components/`:

- **`StatusPill`** — props `{ state: WorkerState }` (or status string); renders the chip using `stateStyles[state]` (`label`, `fg`, `bg`). Used by `AgentCard` and reusable on the dashboard worker cards.
- **`Sparkline`** — props `{ markers: string[] }` (status strings); renders thin bars colored via `runMarker`. Pure presentational, no library.
- **`StatCard`** — props `{ label, value, accent? }`; the tightened metric card used by both Activity stat cards and the Runners stat strip (consolidates the inline `Stat` currently private to `StatCards.tsx`).

In `apps/client/src/lib/`:

- **`recentRunMarkers(runs, agentId, n)`** added to [runStats.ts](../../../apps/client/src/lib/runStats.ts) — the only new pure logic. Everything else reuses `computeAgentHealth`, `buildWorkerCards`/`stateFor`, `relativeTime`.

## Data Flow

No new network calls. All three screens already fetch what they need:

1. **Agents:** `useAgents()` + `useRuns()` → `computeAgentHealth` + `buildWorkerCards` + `recentRunMarkers` (client-side) → per-card stats, live pill, sparkline. Search/status filters apply over this in-memory list.
2. **Activity:** unchanged — `useRuns()` + `useAgents()` → `computeDashboardStats` / `buildWorkerCards` / feed slice. Only presentation changes.
3. **Runners:** `useQuery(['runners'])` (10s refetch) → online/total counts + table rows. Relative times computed client-side from `lastSeen`.

## Error & Empty States

- Agents: existing loading/`isError` handling retained; with zero agents the existing "No agents yet" message stays.
- Agents filter: when search/status filter yields nothing, show a muted "No agents match" line (distinct from the zero-agents empty state).
- Activity: existing loading/error blocks retained (page-bg wrapper simplified after removing `m: -3`).
- Runners: existing query has no explicit error UI today — add a minimal `isError` message ("Failed to load runners. Is the server running?") to match the other pages, plus the new zero-runners empty state.

## Testing

Vitest + Testing Library (the client's existing setup; the repo already has `lib/*.test.ts`). No Playwright (avoids net-new test infra).

- **`lib/runStats.test.ts`:** add cases for `recentRunMarkers` — returns last `n` statuses oldest→newest, ignores archived, pads/empties correctly when fewer than `n` or zero runs, scopes to the given `agentId`.
- **Agent card / page (component tests):**
  - Card renders Runs/Success/Last from a supplied `AgentHealth` (incl. "—" when `successRate`/`lastRunAt` are null).
  - `StatusPill` shows the label/colors for each `WorkerState`.
  - Primary action switches to "View run" when state is running.
  - Search filters by name; status toggle filters by derived state; "No agents match" appears when empty (drive via props/state, not real DnD).
- **Runners:** online/total counts computed from a runner list; relative last-seen rendered; empty state shown when list is empty; "Add runner" opens the connect dialog.
- **Theme smoke:** a card renders on `background.paper` with the border override applied (assert the style is wired, per the jsdom limitation noted in the prior spec — don't assert pixel rendering).
- Existing `dashboard.test.ts` / `reorder.test.ts` / `runStats.test.ts` must continue to pass (reused functions are unchanged).

## Open Questions

None outstanding. Confirmed with the user: full critique across all three screens; Runners trimmed to honest frontend-only (no Platform/Version/Jobs/Capacity); workspace switcher and account block are static display; "Add runner" opens connect-instructions rather than a form; no new dependencies and no backend changes.
