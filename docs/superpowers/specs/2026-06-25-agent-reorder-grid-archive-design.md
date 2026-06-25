# Agent Reorder, 2-per-row Grid, and Archive — Design

**Date:** 2026-06-25
**Repo:** `globale.agent-hub`
**Scope:** Agent list management UX — reordering, grid layout, and soft-delete (archive).

## Problem

The Agents page (`apps/client/src/pages/AgentsPage.tsx`) renders agents as a plain
full-width vertical list in raw insertion order. There is no way to:

1. **Reorder** agents — order is whatever SQLite returns from `findAll()`.
2. View them compactly — one card per row wastes horizontal space.
3. **Remove an agent reversibly** — there is no delete UI at all today, and the only
   repository method (`AgentRepository.delete`) is a hard delete.

This design adds: drag-and-drop reordering, a 2-per-row responsive grid, and an
archive/unarchive (soft-delete) flow that hides agents from the main grid while
keeping them restorable.

## Scope

- Persisted display order for agents, controlled by drag-and-drop.
- Responsive grid: 2 cards per row on `sm`+ screens, 1 per row on `xs`.
- Archive (soft-delete) + unarchive, with a "Show archived" toggle.
- Hard delete retained but surfaced only as "Delete permanently" on archived agents.

## Non-goals

- Changing the existing `enabled` (active/paused) flag semantics. `enabled` and
  `archived` are independent (see Key Decisions).
- Reordering across pages, grouping, folders, or multi-select bulk operations.
- Persisting per-user order (order is global, matching the single-tenant model of
  the existing schema).

## Key Decisions

- **`archived` is separate from `enabled`.** `enabled` = active vs paused (still
  listed, chip shown today). `archived` = hidden from the main grid but restorable.
  A card can be paused-and-visible, or archived-and-hidden. They do not replace each
  other.
- **Archive is the default removal action; hard delete is the escape hatch.** The
  card's primary destructive action archives. "Delete permanently" (existing hard
  `DELETE`) appears only when an agent is already archived.
- **Reorder UX = drag and drop** via `@dnd-kit/sortable` with `rectSortingStrategy`
  (designed for grid layouts). Chosen over up/down arrows and a manual sort field for
  the most natural interaction; the new dependency is acceptable.
- **Mirror the proven `runs` archive pattern.** `runs.archived`,
  `RunRepository.setArchived`, `PATCH /api/runs/:id`, and `ActivityFeed.tsx`'s
  "Show archived" + `opacity: 0.55` dimming are the reference implementations.

## Data Model

Two new columns on the `agents` table in `apps/server/src/db/schema.ts`:

```ts
sortOrder: integer('sort_order').notNull().default(0),
archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
```

**Migration `0004`** (drizzle-kit, out dir `apps/server/src/db/migrations`):

- Add both columns. `drizzle-kit generate` emits only the `ALTER TABLE ADD COLUMN`
  statements — the backfill must be **hand-added to the generated migration SQL**.
- Backfill `sort_order` for existing rows sequentially ordered by `created_at`, so
  current agents retain a stable, distinct order instead of all colliding on `0`.
  Use a **row-by-row update** in the migration (SQLite can't do `UPDATE ... FROM`
  with window functions cleanly), e.g. iterate ids in `created_at` order and set
  `sort_order = i`.
- `archived` defaults to `false` for existing rows.

## Backend

### `AgentRepository.ts`

- `findAll({ includeArchived = false } = {})`
  - Adds `.orderBy(agents.sortOrder)`.
  - When `includeArchived` is false, filters `eq(agents.archived, false)`.
- `create(data)`
  - Assigns `sortOrder = (max(sortOrder) ?? -1) + 1` so new agents append to the end.
  - `archived` defaults to `false`.
- `setArchived(id, archived: boolean)` — direct copy of `RunRepository.setArchived`;
  `update(agents).set({ archived }).where(eq(agents.id, id))`.
- `reorder(orderedIds: string[])`
  - Single `better-sqlite3` transaction (same `sqlite.transaction(...)` pattern used
    by `RunRepository.claimNext`).
  - For each id at array index `i`, `update(agents).set({ sortOrder: i }).where(eq(agents.id, id))`.
  - Ids not present in the array are left untouched (defensive; the client always
    sends the full visible non-archived list).

### `routes/agents.ts`

- `GET /api/agents` — accept optional `?includeArchived=true` querystring (TypeBox
  `Type.Optional(Type.Boolean())`), pass through to `findAll`.
- `PATCH /api/agents/:id` — body `{ archived: boolean }` (copied from the runs PATCH).
  Calls `setArchived`, returns **200 with the updated row** (the runs PATCH returns
  `200`/`404`, not 204 — match that). This is a *new* route that coexists with the
  existing **`PUT /api/agents/:id`** (full edit) — do not convert or remove the PUT.
- `PATCH /api/agents/reorder` — body `{ ids: Type.Array(Type.String()) }`. Calls
  `reorder`. Returns 204. **Registered before** `/:id` routes so `reorder` is not
  captured as an `:id` param.
- `DELETE /api/agents/:id` — unchanged (hard delete, 204).

## Frontend

### `api/client.ts`

- Extend `Agent` interface: add `sortOrder: number` and `archived: boolean`.
- `api.agents.list(includeArchived?: boolean)` — append querystring when true.
- `api.agents.setArchived(id, archived)` → `PATCH /api/agents/:id`.
- `api.agents.reorder(ids: string[])` → `PATCH /api/agents/reorder`.

### `hooks/useAgents.ts`

- `useAgents(includeArchived?)` — pass flag to the query fn; include it in the query
  key (`['agents', { includeArchived }]`) so toggling refetches.
- `useArchiveAgent()` — mutation calling `api.agents.setArchived`, invalidates
  `['agents']`.
- `useReorderAgents()` — mutation calling `api.agents.reorder`, with **optimistic
  update**: on mutate, reorder the cached array; on error, roll back; on settle,
  invalidate `['agents']`.

### `pages/AgentsPage.tsx`

- **Grid container:** replace the bare fragment with
  `Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}`.
- **"Show archived" toggle:** an MUI `Switch`/`FormControlLabel` near the page header
  (mirrors `ActivityFeed.tsx`); drives `useAgents(includeArchived)`.
- **DnD:** wrap the grid in `DndContext` (with `PointerSensor` + `KeyboardSensor` for
  a11y) and `SortableContext` using `rectSortingStrategy`, keyed by the ordered list
  of visible agent ids. Give `PointerSensor` an `activationConstraint`
  (e.g. `{ distance: 5 }`) so a click on/near the handle does not race the
  `CardActionArea` navigation. On `dragEnd`, compute the new order with `arrayMove`,
  call `useReorderAgents` with the full ordered non-archived id list.
- Archived agents are **not draggable** (rendered outside `SortableContext`, or with
  `disabled` sortable). When "Show archived" is on, archived cards appear after active
  ones, dimmed.

### `components/AgentCard.tsx`

- Remove the per-card `mb: 2` (grid `gap` now owns spacing).
- Add a **drag handle** (`DragIndicator` icon) wired to `useSortable` listeners;
  shown only for non-archived cards. Handle must not trigger the card's
  `CardActionArea` navigation (stop propagation).
- **Archived styling:** `opacity: 0.55` when `agent.archived`.
- **Actions** (`CardActions`):
  - Active agent: keep Edit + Run; add `Archive` icon button (`ArchiveIcon` →
    `useArchiveAgent(id, true)`).
  - Archived agent: `Unarchive` icon button (`UnarchiveIcon` →
    `useArchiveAgent(id, false)`) + `Delete permanently` (`useDeleteAgent`, with a
    confirm dialog). **Run and Edit are disabled** while archived (an archived agent is
    inactive and must not be triggered); they re-enable on unarchive.

## Data Flow

1. **Load:** `AgentsPage` → `useAgents(showArchived)` → `GET /api/agents[?includeArchived]`
   → `findAll` returns rows ordered by `sortOrder`.
2. **Reorder:** user drags card → `dragEnd` → optimistic cache reorder + `PATCH
   /api/agents/reorder { ids }` → `reorder` writes `sortOrder = index` in a transaction.
3. **Archive:** click Archive → `PATCH /api/agents/:id { archived: true }` →
   `setArchived` → query invalidated → card disappears from main grid (reappears under
   "Show archived").
4. **Unarchive:** click Unarchive (from archived view) → `{ archived: false }` → card
   returns to the active grid at its existing `sortOrder`.
5. **Delete permanently:** from archived view → confirm → `DELETE /api/agents/:id`.

## Error Handling

- **Reorder failure:** optimistic update rolls back to the prior cached order; a
  non-blocking error toast/snackbar is shown. Server stays the source of truth via the
  settle invalidation.
- **Archive/unarchive failure:** mutation `onError` surfaces an error; query
  invalidation on settle re-syncs the visible state.
- **Delete permanently:** gated behind a confirm dialog; on failure show an error and
  leave the agent in place.
- **`reorder` with unknown ids:** silently skipped (no row matches) — the transaction
  still commits the known ids.
- **Concurrent reorder + create:** new agents get `max+1`; a stale reorder list simply
  omits them, leaving their `sortOrder` untouched. Next load reflects the true state.

## Testing

- **Backend (Jest, `apps/server`):**
  - `AgentRepository.reorder` writes sequential `sortOrder` and is transactional.
  - `findAll` orders by `sortOrder` and filters archived unless `includeArchived`.
  - `create` appends with `max+1`.
  - `setArchived` toggles the flag.
  - Route tests for `PATCH /:id`, `PATCH /reorder` (route ordering — `/reorder` not
    swallowed by `/:id`), and `GET ?includeArchived`.
  - Migration `0004` backfills distinct `sort_order` values for pre-existing rows.
- **Frontend (Vitest + Testing Library — the client's existing setup; no Playwright,
  to avoid net-new test-infra scope):**
  - The grid container applies the 2-column `gridTemplateColumns` `sx` (note: true
    responsive `sm+` rendering can't be asserted in jsdom — assert the style is wired,
    not the rendered column count).
  - Drag reorder fires `reorder` with the expected id order; optimistic update + rollback
    (drive `dragEnd` via the handler / mocked dnd events rather than real pointer drag).
  - Archive removes a card from the default view; "Show archived" reveals it dimmed and
    non-draggable; Unarchive restores it.
  - "Delete permanently" only present on archived agents and is confirm-gated.

## Open Questions

None — design confirmed with the user (archive separate from `enabled`; hard delete
retained only as "Delete permanently" on archived agents).
