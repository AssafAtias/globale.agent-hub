# Agent Identity Layer — Design

**Date:** 2026-06-24
**Status:** Approved (design) — pending implementation plan
**Repo:** `globale.agent-hub`

## Summary

Give each agent a distinct, recognizable **identity**: a chosen avatar, a persona
(role title + short bio), and a set of **skill badges** that characterize what it
does. Surface this identity both on the existing agent cards and on a new per-agent
**profile page** that also shows the agent's recent activity (reusing existing run
data).

This is a **characterization / identity layer only**. It does not change how agents
run. Skills are descriptive badges — they have **no runtime effect** and the runner
(`packages/runner`) is **not touched**.

## Goals

- Agents feel like distinct characters (name + avatar + title + bio + skills).
- Identity is visible at a glance on the Agents list, and in full on a profile page.
- Skills are picked from a curated catalog, with the option to add a custom one.
- Avatars are picked from a curated preset gallery (no uploads).
- A profile page shows the agent's recent activity, reusing existing run data.

## Non-Goals (YAGNI)

- No runtime effect from skills (no prompt injection, no Claude Code skill loading).
- No avatar image uploads or server-side image storage.
- No live/streaming activity view — existing run history/detail pages remain the
  monitoring surface. "Recent activity" on the profile is a filtered view of the
  same run data.
- No server-driven/editable catalogs — avatar gallery and skills catalog are
  client-side constants (Approach A, approved).

## Approach (A — client-side catalogs)

The server stores only opaque identity values; the curated lists live in the client.
This mirrors the existing pattern where the server stores `repos` and `outputs` as
opaque JSON strings and the client owns their meaning.

## Data Model

Extend the existing `agents` table (`apps/server/src/db/schema.ts`) with four
nullable/defaulted columns — additive only, no changes to existing columns:

| Field | Type | Notes |
|---|---|---|
| `avatarKey` | `text('avatar_key')`, nullable | id of a client-gallery avatar; when null/unknown the client renders an initials-on-color fallback |
| `title` | `text('title')`, nullable | persona role/title, e.g. "Senior Bug Hunter" |
| `bio` | `text('bio')`, nullable | short free-text description |
| `skills` | `text('skills').notNull().default('[]')` | JSON `string[]` of badge labels |

A new Drizzle migration is added under `apps/server/src/db/migrations/` (generated
via the project's existing drizzle migration workflow). All four fields are optional
on input so existing agents remain valid; missing `skills` defaults to `[]`.

## Server Changes

`apps/server` only — no runner changes.

- **`services/AgentRepository.ts`** — include `avatarKey`, `title`, `bio`, `skills`
  in create / update / read mapping. `skills` is stored/round-tripped as a JSON
  string (same convention as `repos`/`outputs`).
- **`api/routes/agents.ts`** — add the four fields to the create and update request
  schemas (all optional) and to the response shape, following the existing TypeBox
  schema style. Validation: `skills` must be an array of non-empty strings;
  `title`/`bio` are bounded-length strings; `avatarKey` is an optional string.
- **Runs API** — unchanged. The profile's activity panel reuses `GET /api/runs`.

## Client Changes

Stack in use: React + MUI + `@tanstack/react-query` + `react-router-dom`.

### New constants
- **`src/constants/avatars.ts`** — curated gallery: an array of `{ key, label, src }`
  entries backed by bundled SVG assets in `src/assets/avatars/`. Exposes a lookup by
  key. ~8–12 distinct illustrations (robots/characters).
- **`src/constants/skills.ts`** — curated skill catalog (e.g. Code Review, Jira,
  GitLab, Testing, Refactoring, Documentation, Security, Performance). Plain
  `string[]` plus a helper for de-duping/normalizing custom additions.

### New components
- **`src/components/AgentAvatar.tsx`** — `({ agent | avatarKey, name, size })`;
  renders the gallery image for the key, or an initials-on-deterministic-color
  fallback when the key is missing/unknown. Single source of truth for avatar
  rendering across cards and profile.
- **`src/components/AvatarPicker.tsx`** — grid of gallery avatars; selected one is
  highlighted; used in the config form.
- **`src/components/SkillsSelector.tsx`** — multi-select from the catalog (MUI
  `Autocomplete` with `freeSolo` for custom additions); renders chosen skills as
  removable chips; normalizes/de-dupes custom entries.

### Enhanced surfaces
- **`src/components/AgentCard.tsx`** — lead with `AgentAvatar` + name + `title`;
  show skill badges (MUI `Chip`s, capped with a "+N" overflow); keep existing
  type/model/enabled/repos and the Edit/Run actions. The card body links to the
  agent profile (`/agents/:id`).
- **`src/pages/AgentConfigPage.tsx`** — add fields: `AvatarPicker`, `title`
  (text), `bio` (multiline text), `SkillsSelector`. Wired through the existing
  agent create/update mutation.

### New page
- **`src/pages/AgentProfilePage.tsx`** at route `/agents/:id` (registered in
  `App.tsx`):
  - Header: large `AgentAvatar`, name, online/enabled indicator, `title`, `bio`.
  - Skills section: full set of skill chips.
  - **Recent activity**: reuses `useRuns()` and filters client-side to
    `run.agentId === id`, sorted by `createdAt` desc, showing the most recent N
    (e.g. 10) with status badge (existing `RunStatusBadge`) and a link to the run
    detail page. No server change (the list already refetches every 5s).
  - A "Configure agent" action linking to `AgentConfigPage`.

### API client / types
- **`src/api/client.ts`** — extend the `Agent` type with `avatarKey?: string`,
  `title?: string`, `bio?: string`, `skills: string` (JSON string, parsed in the UI
  like `repos`). Create/update payloads accept the new fields.

## Data Flow

1. User edits an agent in `AgentConfigPage` → picks avatar, fills title/bio, selects
   skills → submit → existing agent mutation → `agents.ts` route → `AgentRepository`
   persists the four fields (skills as JSON string).
2. `AgentsPage` lists agents (`useAgents`) → each `AgentCard` renders identity via
   `AgentAvatar` + parsed `skills`.
3. Clicking a card → `AgentProfilePage` (`/agents/:id`) renders full identity and a
   filtered slice of `useRuns()` for that agent.

## Error Handling

- `skills` parsing in the UI uses the existing try/catch-to-`[]` pattern already used
  for `repos` in `AgentCard`.
- Unknown/missing `avatarKey` falls back to the initials avatar (never a broken
  image).
- Server rejects malformed `skills` (non-array / empty strings) with the existing
  validation-error response shape.
- Profile page handles agent-not-found (404 from the agent fetch) with a simple
  empty state.

## Testing

- **Server** (matches existing test style):
  - `AgentRepository` round-trips the four new fields, including `skills` JSON and
    the `'[]'` default.
  - `agents.ts` create/update accept and validate the new fields; malformed `skills`
    is rejected.
- **Client** (matches existing client test setup, if present):
  - `AgentAvatar` renders gallery image for a known key and initials fallback for an
    unknown/missing key.
  - `SkillsSelector` adds catalog and custom skills and de-dupes.
  - `AgentCard` renders avatar, title, and skill chips (with overflow).
  - `AgentProfilePage` filters runs to the current agent.

## Affected / New Files

**Server**
- `apps/server/src/db/schema.ts` (+4 columns)
- `apps/server/src/db/migrations/<new>.sql` (+ meta)
- `apps/server/src/services/AgentRepository.ts`
- `apps/server/src/api/routes/agents.ts`

**Client**
- `src/constants/avatars.ts` (new) + `src/assets/avatars/*` (new)
- `src/constants/skills.ts` (new)
- `src/components/AgentAvatar.tsx` (new)
- `src/components/AvatarPicker.tsx` (new)
- `src/components/SkillsSelector.tsx` (new)
- `src/components/AgentCard.tsx` (enhanced)
- `src/pages/AgentConfigPage.tsx` (enhanced)
- `src/pages/AgentProfilePage.tsx` (new) + route in `src/App.tsx`
- `src/api/client.ts` (extend `Agent` type + payloads)

## Open Questions

None blocking. The avatar gallery art (specific SVGs) will be chosen during
implementation; any reasonable distinct set satisfies the design.
