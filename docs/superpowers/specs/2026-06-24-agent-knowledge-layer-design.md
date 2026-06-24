# Agent Knowledge Layer — Design

**Date:** 2026-06-24
**Status:** Approved (design)
**Scope:** Sub-projects B (real skills) + C (context/memory bank) of the larger agent-hub effort. Sub-project D (self-healing retry loop) is separate and builds on C.

## Problem

Two gaps make agents in agent-hub "dumb":

1. **Skills are cosmetic.** The Skills selector on the agent config page offers 10 hardcoded strings ([apps/client/src/constants/skills.ts](../../../apps/client/src/constants/skills.ts)) with no connection to the real skill library at `C:\GlobalE\.claude\skills`. Worse, the selected skills never reach the executor — the `Job` passed to the runner carries only `name/model/prompt/repos`, so a skill selection changes nothing about how an agent behaves. The user explicitly cannot attach real `.claude/skills` to an agent today.

2. **Agents are stateless.** Each run is a fresh Anthropic Messages API call with a system prompt + context. Agents have no persistent focus (what they're working on) and no memory of prior runs, so they cannot accumulate knowledge or be steered over time.

## Goal

- **B:** Make the agent's Skills selector list the real skills from `C:\GlobalE\.claude\skills`, and inject the chosen skills' content into the agent's prompt at run time so the agent actually follows that methodology.
- **C:** Give each agent a user-editable **Focus** and an auto-accumulating **memory bank** (notes the agent appends after each run), both injected into future runs and surfaced in the UI.

This is delivered as **two implementation plans** (B then C); each ships working software independently.

## Approach

**Runner-side injection.** The runner already reads `CLAUDE.md` from disk ([LocalEnricher.ts](../../../packages/runner/src/context/LocalEnricher.ts)), so it assembles the enriched prompt. The server stays light (skill catalog + memory persistence only); skill *content* never enters the DB or the HTTP job payload.

Rejected alternatives: server-side prompt assembly (couples the server to the skills dir, pushes large skill text over HTTP per job); importing skill bodies into the DB (duplicates content, needs a sync step).

### Configuration

- New env var `SKILLS_DIR`, default `C:\GlobalE\.claude\skills`, read by **both** server (to scan the catalog) and runner (to load bodies). Added to `apps/server/src/config/environment.ts` and the runner config, and documented in `.env.example`.

---

## B — Skills (functional injection)

### Skill source format
Each skill is a folder under `SKILLS_DIR` containing a `SKILL.md` with YAML frontmatter:
```
---
name: pr-review-methodology
description: Comprehensive PR review methodology ...
---
<body>
```
The skill's identity is its frontmatter `name` (a slug). Only `SKILL.md` is used — reference sub-files (`reference.md`, `scripts/`, etc.) are NOT injected.

### Server
- New `SkillCatalog` service (`apps/server/src/services/SkillCatalog.ts`): scans `SKILLS_DIR` for immediate `*/SKILL.md`, parses frontmatter `name` + `description`, returns `{ name, description }[]` sorted by name. Skips folders whose `SKILL.md` is missing or has no `name`. Tolerates a missing `SKILLS_DIR` (returns `[]`).
- New route `GET /api/skills` → `200` `[{ name: string, description: string }]`.

### Client
- `apps/client/src/api/client.ts`: add `api.skills.list()` → `GET /api/skills`, typed `{ name: string; description: string }[]`.
- New hook `useSkills()` (react-query, `queryKey: ['skills']`).
- `SkillsSelector` becomes a **searchable multi-select** (MUI `Autocomplete`, `multiple`): options are the catalog objects; filtering matches typed text against both `name` and `description`; each option renders name (primary) + description (secondary); selected skills render as chips showing the name. The agent still stores selected skill **names** (`string[]`), unchanged on the wire.
  - **Grouping is out of scope:** skill frontmatter has no category field, so there is nothing to group by. The picker is searchable, not grouped. (A future `category` frontmatter field could enable `Autocomplete` `groupBy`.)
- `apps/client/src/constants/skills.ts`: remove the hardcoded `SKILL_CATALOG`; keep `normalizeSkill` and `dedupeSkills`.
- `AgentProfilePage` skills chips continue to render the stored names (now real slugs).

### Runner
- New `SkillLoader` (`packages/runner/src/context/SkillLoader.ts`), constructed with `SKILLS_DIR`:
  - `load(skillNames: string[]): string` — for each name, read `<SKILLS_DIR>/<name>/SKILL.md`, strip the frontmatter block, cap the body to `MAX_SKILL_CHARS` (6000), skip (with a `console.warn`) any skill whose file is missing/unreadable, and concatenate the kept bodies under per-skill headings. Cap the combined output to `MAX_SKILLS_TOTAL_CHARS` (24000).
  - Resolves a skill folder by exact `name` match on the directory name; if not found by directory name, falls back to scanning for a `SKILL.md` whose frontmatter `name` matches.
- `Job` type (`packages/runner/src/executor.ts`) gains `agent.skills: string` (JSON array; already present on the agent row returned by `/api/runs/next`). `isJob` does not need to require it (treat absent as `[]`).
- `executeJob` parses `agent.skills`, calls `SkillLoader.load`, and prepends a `## Skills` section to the system prompt (see Prompt Assembly).

---

## C — Context + memory bank

### Schema (`apps/server/src/db/schema.ts`)
- Add `focus: text('focus')` (nullable) to `agents`.
- New table `agent_memory`:
  ```ts
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  runId: text('run_id'),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
  ```
- Drizzle migration generated and applied manually to dev DBs (no runtime migrator; idempotent apply via `PRAGMA`/`CREATE TABLE IF NOT EXISTS`, as in the activity-archive feature).

### Server
- `AgentMemoryRepository`: `listForAgent(agentId, limit)` (newest-first), `append({ agentId, runId, note })`, `clearForAgent(agentId)`.
- Routes:
  - `GET /api/agents/:id/memory` → `{ focus: string | null, entries: { id, runId, note, createdAt }[] }` (entries capped to the most recent `MEMORY_INJECT_LIMIT` = 20, newest-first). 404 if agent missing.
  - `POST /api/agents/:id/memory` body `{ runId?: string, note: string }` → append, return the created entry (201). 404 if agent missing; reject empty note (400).
  - `DELETE /api/agents/:id/memory` → clear all entries for the agent (204).
- `focus` is part of the agent row, so it is edited through the existing `PUT /api/agents/:id` (add `focus` to the `AgentBody` TypeBox schema as `Type.Optional(Type.String({ maxLength: 4000 }))`, serialized like the other optional fields).

### Client
- `AgentConfigPage`: add a **Focus** multiline `TextField` (state + load + include in the save body). Helper text: "What this agent is currently working on — injected into every run."
- `AgentProfilePage`: add a **Memory** section below "Recent activity": fetch `GET /api/agents/:id/memory`, render `focus` (if set) and entries newest-first (note + timestamp), and a **Clear memory** button (calls `DELETE`, confirms first, refetches). Read-only entries — no per-entry edit/delete.
- `api.client.ts`: add `api.agents.memory.get(id)`, `.append(id, body)`, `.clear(id)`; add `focus?: string | null` to the `Agent` interface and `focus?: string` to `AgentInput`.

### Runner
- Before executing, the runner fetches `GET /api/agents/:id/memory` (new method on the runner's server client) to get `focus` + recent `entries`.
- `executeJob` injects, after the Skills section:
  - `## Focus` — the agent's focus text (omitted if empty).
  - `## Memory (recent)` — the recent entries (newest-first), each as a bullet, plus a standing instruction: *"To record something for your future self, end your reply with a single `<memory-update>…</memory-update>` block containing a concise note (what you did / what you learned). Write nothing there if there is nothing worth remembering."*
- After the model responds, `executeJob`:
  - Extracts the first `<memory-update>…</memory-update>` block (if any), trims it, and **strips it from the returned result** so it does not appear in the dispatched output.
  - Returns both the cleaned result and the optional note.
- The poller (`packages/runner/src/poller.ts`) posts the result as today, and — if a note was extracted — `POST`s it to `/api/agents/:id/memory` with the `runId`. A failed memory POST is logged and does not fail the run.

---

## Prompt Assembly (runner, system prompt order)

```
## Skills
<injected SKILL.md bodies, per-skill headings>

## Focus
<agent.focus>

## Memory (recent)
- <entry note>            (newest-first, up to MEMORY_INJECT_LIMIT)
...
<memory-update instruction>

---

<original agent.prompt>
```

Sections with no content are omitted entirely. The run `context` remains the user message, unchanged.

## Testing

- **Server (jest):**
  - `GET /api/skills` against a temp fixture skills dir: returns parsed name/description, skips folders missing `SKILL.md` or `name`, sorted.
  - Memory endpoints: append + list (newest-first, capped at limit), clear, 404 on unknown agent, 400 on empty note.
  - `focus` round-trips through `PUT/GET /api/agents/:id`.
  - In-memory test schema updated with `focus` column + `agent_memory` table.
- **Runner (unit):**
  - `SkillLoader.load`: loads a body, strips frontmatter, caps to `MAX_SKILL_CHARS`, skips missing skills, resolves by dir name and by frontmatter name, total cap.
  - memory-update extractor: extracts + strips a block; absent block → result unchanged + no note; only the first block is taken.
- **Client:** follow existing patterns; `SkillsSelector` and memory views are light. (No heavy component tests beyond what the repo already does.)

## Risks

- **Token budget:** injecting multiple full `SKILL.md` bodies plus memory can grow the prompt. Mitigated by per-skill and total caps and the recent-entries limit. The existing executor uses non-streaming `max_tokens: 16000` output; input headroom is large but not unlimited — caps keep it bounded.
- **Skill name vs folder name drift:** a skill's frontmatter `name` may differ from its folder name. `SkillLoader` resolves by folder name first, then by frontmatter `name`, to be robust.
- **Existing agents:** `focus` is nullable and `skills` already defaults to `[]`; existing agents keep working with empty knowledge.
- **`<memory-update>` reliability:** the model may format the block imperfectly. The extractor is tolerant (first well-formed block only); a malformed/absent block simply yields no memory write — never an error.

## Non-goals (deferred to D or later)

- No automatic retry/learning loop, pipeline monitoring, or inter-agent messaging (sub-project D).
- No per-entry editing/deleting of memory (only clear-all).
- No grouping/categories in the skill picker (no category metadata exists).
- Skill reference sub-files are not injected (only `SKILL.md`).

## Open questions

None outstanding — skill behavior (inject bodies), memory model (focus + auto-appended notes), and UI surfacing (focus editable, memory viewable + clear) confirmed during brainstorming; picker is searchable (grouping not feasible without category metadata).
