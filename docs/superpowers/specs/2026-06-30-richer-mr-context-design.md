# Richer MR Context (linked Jira + CI status + discussions) — Design

**Date:** 2026-06-30
**Repo:** `globale.agent-hub`
**Status:** Approved (spec review passed)
**Roadmap:** Phase 1B (see memory `agent-hub-roadmap`)

## Problem

When a GitLab MR webhook fires, `ContextFetcher` puts only the MR title/description/branch/diff into `run.context`. The reviewing agent doesn't see *what the change is meant to do* (the linked Jira ticket), whether *CI is red*, or *what reviewers already said*. Phase 1A gave agents read-only repo tools, so file/code context is now self-serve — but these three things live in **other systems** the agent's tools can't reach, so they must be pre-fetched.

## Goal

Enrich the MR-review `run.context` with three cross-system signals: the linked Jira ticket, the CI pipeline status + failed job names, and existing MR discussion comments. Server-side only; best-effort; no schema/client change.

## Non-goals (YAGNI)

- No failed-job **logs** (status + job names only).
- No file-content fetching (1A's read-only tools cover it).
- No related-MR graph, no manual-trigger enrichment (manual runs have no MR).
- No new dependencies, no DB migration, no client change.

## Decisions

| Question | Decision |
|---|---|
| Enrichments | Linked Jira ticket, CI pipeline status + failed job names, existing MR discussions |
| CI depth | Status + failed job **names** (no logs) |
| Linked ticket field | **Reuse** the existing `ctx.ticket` field + its `Jira Ticket` serialization (same block the Jira-trigger path produces) |
| Failure model | Each enrichment **independent best-effort** (own try/catch + `console.warn`), matching the existing pattern |

## Components

### New: `apps/server/src/services/issueKey.ts`
```ts
export function extractIssueKey(sourceBranch: string, title: string, description: string): string | null
```
- Scans, in priority order, `sourceBranch` → `title` → `description`; returns the first match of `/\b[A-Z][A-Z0-9]+-\d+\b/` (e.g. `CORE-211920`), else `null`.
- Branch wins because Global-E branches are `…/CORE-XXXXXX-slug` / `bug/CORE-123`.
- The regex is intentionally generic (any `ABC-123` key, not only `CORE-`). A stray non-CORE key is harmless: it's passed to `getTicket`, which 404s → caught by the best-effort try/catch (no ticket added). Known behavior, not a bug.
- Pure, no I/O.

### Modify: `apps/server/src/services/GitLabClient.ts`
Add two methods, each thin over `fetch`, with the JSON→shape mapping in **pure exported helpers** (unit-tested; the network wrappers stay untested like the existing `getMrContext`):

```ts
export interface MrPipeline { status: string; failedJobs: string[]; }
export interface MrDiscussionNote { author: string; body: string; }

// pipelinesJson: Array<{ id: number; status: string }>  → first element, or null if empty/garbage
//   (GitLab returns this list newest-first, so [0] is the latest pipeline — no sort needed)
export function parsePipeline(pipelinesJson: unknown): { id: number; status: string } | null
// jobsJson: Array<{ name: string; status: string }>  → names where status === 'failed'
export function parseFailedJobs(jobsJson: unknown): string[]
// discussionsJson: Array<{ notes: Array<{ system?: boolean; body: string; author?: { name?: string; username?: string } }> }>
//   → flatten all notes across all discussions, drop notes where `system` is truthy,
//     map to { author, body } (author = note.author.name ?? note.author.username ?? 'unknown'; body sliced to 1000),
//     then take the FIRST 30 of the flattened list.
export function parseDiscussions(discussionsJson: unknown): MrDiscussionNote[]

// methods on GitLabClient:
async getMrPipeline(projectPath: string, mrIid: number): Promise<MrPipeline | null>
async getMrDiscussions(projectPath: string, mrIid: number): Promise<MrDiscussionNote[]>
```
- `getMrPipeline`: GET `…/merge_requests/:iid/pipelines`; `const p = parsePipeline(json)`. If `p` is null → return `null` (no pipelines). If `p.status === 'success'` → return `{ status: 'success', failedJobs: [] }` (no jobs call). Otherwise GET `…/pipelines/${p.id}/jobs?scope[]=failed` (note: GitLab v4 uses the repeated `scope[]=failed` query param, NOT `scope=failed`; the `p.id` is the pipeline's own numeric id from `parsePipeline`, not the MR iid) and return `{ status: p.status, failedJobs: parseFailedJobs(jobsJson) }`.
- `getMrDiscussions`: GET `…/merge_requests/:iid/discussions`; return `parseDiscussions(json)`.
- Both use the existing `PRIVATE-TOKEN` header + `https://gitlab.com` baseUrl convention.

### Modify: `apps/server/src/services/ContextFetcher.ts`
- `FetchedContext` gains `pipeline?: MrPipeline` and `discussions?: MrDiscussionNote[]`.
- In `fetch`, inside the existing `mr:` branch, **after** `getMrContext` succeeds, run three independent best-effort enrichments — each in its own `try/catch` with `console.warn` on failure (so one failing never drops the diff or the others):
  1. `const key = extractIssueKey(ctx.mr.sourceBranch, ctx.mr.title, ctx.mr.description)`; if `key && this.jira` → `ctx.ticket = await this.jira.getTicket(key)`.
  2. `ctx.pipeline = await this.gitlab.getMrPipeline(project, iid) ?? undefined`.
  3. `ctx.discussions = await this.gitlab.getMrDiscussions(project, iid)` (skip assigning if empty array, to keep the section out of the serialization).
- `serializeForRunner` gains two sections (the `Jira Ticket` section already exists and now also covers the linked ticket):
  - `Pipeline` → first line `${status}`; then, only if `failedJobs` is non-empty, a second line `Failed jobs: a, b, c`. (So a `running`/`pending`/`success` pipeline emits just the status line.)
  - `Existing MR Comments` → `- <author>: <body>` lines.
  Omit each section entirely when its data is absent (`pipeline` undefined / `discussions` empty).

## Data flow

`mr:opened` webhook → `ContextFetcher.fetch` → `getMrContext`, then best-effort `extractIssueKey`→`getTicket`, `getMrPipeline`, `getMrDiscussions` → `serializeForRunner` → `run.context` → runner.

## Error handling

Each enrichment is wrapped independently (`try/catch` + `console.warn('[ContextFetcher] …', e)`), mirroring the current MR/ticket handling. Jira is skipped when `this.jira` is undefined (unconfigured), exactly as today. The diff is always preserved.

## Testing (Jest)

- **`test/issueKey.test.ts`** — pure `extractIssueKey`: `CORE-211920-foo` branch → `CORE-211920`; `bug/CORE-123` → `CORE-123`; no key in branch but in title → from title; only in description → from description; none anywhere → `null`; branch-wins-over-title when both have (different) keys.
- **`test/gitlabParsers.test.ts`** — pure helpers: `parsePipeline` (first element `{id,status}`; empty array/garbage → `null`); `parseFailedJobs` (filters to `status==='failed'`, returns names; empty/garbage → `[]`); `parseDiscussions` (flattens `discussions[].notes[]`, drops `system:true` notes, maps author/body, caps at 30 after flattening, slices long bodies; author fallback chain name→username→'unknown').
- **`test/ContextFetcher.test.ts`** (extend) — using the existing fake-injection style. The fake `(f as any).gitlab` must expose **`getMrContext`** (returning a fake `MrContext` so the `mr:` branch guard passes) **plus** `getMrPipeline` and `getMrDiscussions`; `(f as any).jira` exposes `getTicket`. Build a fake gitlab MR webhook event (with `payload.project.path_with_namespace` and `payload.object_attributes.iid`). Cases:
  - linked-ticket branch (e.g. `sourceBranch: 'feature/CORE-9-x'`) → `serializeForRunner` contains the `Jira Ticket` block, `Pipeline` (with `Failed jobs:`), and `Existing MR Comments`.
  - best-effort: a fake whose `getMrPipeline` throws → serialization still contains the diff + ticket + comments (Pipeline section absent, no throw escapes `fetch`).
  - empty discussions / `getMrPipeline` returns null → those sections omitted; diff still present.

## Affected files

- `apps/server/src/services/issueKey.ts` (new)
- `apps/server/src/services/GitLabClient.ts` (modify — 2 methods + 3 pure helpers `parsePipeline`/`parseFailedJobs`/`parseDiscussions` + 2 interfaces)
- `apps/server/src/services/ContextFetcher.ts` (modify — fields, fetch enrichment, serialize)
- `apps/server/test/issueKey.test.ts` (new)
- `apps/server/test/gitlabParsers.test.ts` (new)
- `apps/server/test/ContextFetcher.test.ts` (extend)

## Deployment note

Server runs from `dist/` — after merge run `npx tsc` in `apps/server` and restart `node dist/index.js`. Enrichment only affects webhook-triggered MR runs; no env var, no DB migration, no new dependency. Requires `GITLAB_API_TOKEN` (already required for diffs) and, for the linked ticket, `JIRA_EMAIL`+`JIRA_API_TOKEN` (already used by the Jira path).
