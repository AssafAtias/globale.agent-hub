# Bitbucket Support (Core PR-review loop) — Design

**Date:** 2026-06-30
**Repo:** `globale.agent-hub`
**Status:** Approved (spec review passed)
**Roadmap:** Phase 2A (see memory `agent-hub-roadmap`)

## Problem

agent-hub only speaks GitLab + Jira. The **Core** monolith lives on **Bitbucket Cloud** (`bitbucket.org/globaleteam/core`), so PR review — the highest-value use case — can't flow through the hub. `ParsedWebhookEvent` already lists `'bitbucket'` as a platform, but there is no parser, client, route, or dispatch path.

## Goal

Support the **Core PR-review loop** on Bitbucket Cloud: PR webhook → fetch PR diff → run agent → post the review back as a PR comment, with linked-Jira enrichment. Reuse the existing platform-agnostic pipeline (`MrContext`, `matchAgents`, `mr:*` events, `serializeForRunner`).

## Non-goals (YAGNI)

- Bitbucket pipeline status / existing-PR-comments context (deferred; v1 is diff + linked Jira).
- Bitbucket Server/Data Center (Cloud only).
- Draft-PR creation, inline/line comments (single summary comment only).
- `pullrequest:rejected` (PR declined) and other Bitbucket event keys — unmapped → null → 200 `{skipped}` (intentionally not handled).
- No DB migration, no client/schema change.

> Note on `runs.ts:81`: the `ticket-to-code` manual-run `ContextFetcher` gets the Bitbucket args appended too, for construction-site uniformity. `fetchOpenAssignedTicket` never uses the Bitbucket client, so the args are inert there — intentional, not dead code to remove.

## Decisions

| Question | Decision |
|---|---|
| v1 scope | **Core review loop**: PR diff → run → post comment back + linked Jira |
| Webhook auth | **Secret token in the URL** — `?token=<secret>` verified against `BITBUCKET_WEBHOOK_SECRET` |
| Event vocabulary | **Reuse `mr:opened`/`mr:updated`/`mr:merged`** (Bitbucket `pullrequest:created`/`updated`/`fulfilled`) |
| API auth | **Bearer** (repo/workspace access token) by default; **Basic** (`username:app_password`) when `BITBUCKET_USERNAME` set — mirrors `JiraClient` |
| Context shape | **Reuse `MrContext`** — a PR maps cleanly to it |

## Components

### Config — `apps/server/src/config/environment.ts`
Add (all optional, like the other tokens): `BITBUCKET_API_TOKEN`, `BITBUCKET_USERNAME`, `BITBUCKET_WEBHOOK_SECRET`. No baseUrl env (constant `https://api.bitbucket.org`).

### New: `apps/server/src/services/BitbucketClient.ts`
```ts
export function bitbucketAuthHeader(token: string, username?: string): string
  // username ? `Basic base64(username:token)` : `Bearer token`  (pure, exported, tested)
export function prJsonToMrContext(pr: unknown, diff: string): MrContext  // pure, exported, tested

export class BitbucketClient {
  constructor(private token: string, private username?: string, private baseUrl = 'https://api.bitbucket.org') {}
  async getPrContext(workspaceRepo: string, prId: number): Promise<MrContext>
  async postPrComment(workspaceRepo: string, prId: number, body: string): Promise<void>
}
```
- **Reuses `MrContext`** (imported from `GitLabClient.ts`).
- `getPrContext`: GET `…/2.0/repositories/${workspaceRepo}/pullrequests/${prId}` (JSON) **and** GET `…/2.0/repositories/${workspaceRepo}/pullrequests/${prId}/diff` (raw text — Bitbucket returns a unified-diff string, NOT JSON), in parallel; build via `prJsonToMrContext(prJson, diff)`. Diff text is **hard-capped at `60_000` chars** (`diff.slice(0, 60000)`) — a fixed value (GitLab's client has no char cap; do not try to "match" it). `workspaceRepo` (e.g. `globaleteam/core`) goes into the path with its `/` between workspace and repo-slug **preserved unencoded** (Bitbucket expects `{workspace}/{repo_slug}`); do not `encodeURIComponent` the whole thing.
- `prJsonToMrContext` maps: `title`, `description ?? ''`, `source.branch.name` → `sourceBranch`, `destination.branch.name` → `targetBranch`, `links.html.href` → `mrUrl` (Bitbucket PR JSON nests the URL at `links.html.href`, unlike GitLab's flat `web_url`), and the passed `diff`.
- `postPrComment`: POST `…/2.0/repositories/${workspaceRepo}/pullrequests/${prId}/comments` with `{ content: { raw: body.slice(0, 32000) } }` (32000 is a conservative cap; Bitbucket's comment limit is ≈32767), `Content-Type: application/json` + the auth header.
- Auth via `bitbucketAuthHeader(this.token, this.username)`. **Note the ctor param is named `username`** (not `email` as in `JiraClient`) — same `Basic base64(credential:token)` pattern, different credential.

### `parseBitbucketEvent(body, eventKey)` — `apps/server/src/services/WebhookMatcher.ts`
```ts
export function parseBitbucketEvent(body: Record<string, unknown>, eventKey: string): ParsedWebhookEvent | null
```
- `eventKey` is the `X-Event-Key` header value. Map: `pullrequest:created → mr:opened`, `pullrequest:updated → mr:updated`, `pullrequest:fulfilled → mr:merged`. Unmapped → null.
- `repo = bitbucket:${body.repository.full_name}` (e.g. `bitbucket:globaleteam/core`). Null if `full_name` missing.
- `sourceRef = body.pullrequest?.source?.branch?.name`.
- `payload = body`.

### `/webhooks/bitbucket` route — `apps/server/src/api/routes/webhooks.ts`
- Schema: `querystring: Type.Object({ token: Type.Optional(Type.String()) }, { additionalProperties: true })`, `headers: Type.Object({ 'x-event-key': Type.Optional(Type.String()) }, { additionalProperties: true })` (the header MUST be `Optional` + `additionalProperties: true` so a missing/extra header never yields a 400), `body: Type.Any()`.
- If `config.BITBUCKET_WEBHOOK_SECRET` is set and `req.query.token !== secret` → 401. If unset, `app.log.warn` (same convention as the Jira route's unauthenticated warning).
- `const eventKey = req.headers['x-event-key'] as string | undefined` (→ `''` if absent).
- `parseBitbucketEvent(body, eventKey)` → null → 200 `{skipped}`. Then identical `matchAgents` → `fetcher.fetch` → `serializeForRunner` → `RunRepository.create` per matched agent → 200 `{created}`. Mirrors the GitLab route exactly.

### `ContextFetcher` — `apps/server/src/services/ContextFetcher.ts`
- Constructor appends `bitbucketToken?`, `bitbucketUsername?` (after the existing 4 args); if `bitbucketToken` → `this.bitbucket = new BitbucketClient(bitbucketToken, bitbucketUsername)`.
- `fetch` adds, after the existing branches:
  ```
  if (event.platform === 'bitbucket' && this.bitbucket) {
    const repo = event.payload.repository?.full_name;
    const prId = event.payload.pullrequest?.id;
    if (repo && prId != null) {
      try { ctx.mr = await this.bitbucket.getPrContext(repo, prId); }
      catch (e) { console.warn('[ContextFetcher] Failed to fetch Bitbucket PR context:', e); }
      if (ctx.mr) {
        const key = extractIssueKey(ctx.mr.sourceBranch, ctx.mr.title, ctx.mr.description);
        if (key && this.jira) {
          try { ctx.ticket = await this.jira.getTicket(key); }
          catch (e) { console.warn('[ContextFetcher] Failed to fetch linked Jira ticket:', e); }
        }
      }
    }
  }
  ```
- `serializeForRunner` unchanged (uses `ctx.mr` / `ctx.ticket`).

### `ResultDispatcher` — `apps/server/src/services/ResultDispatcher.ts`
- Constructor appends `bitbucketToken?`, `bitbucketUsername?` (after `teamsWebhook`); if `bitbucketToken` → `this.bitbucket = new BitbucketClient(bitbucketToken, bitbucketUsername)`.
- **Restructure the `pr_comment` branch so the two platforms are independent (CRITICAL).** Today the branch is `if (output === 'pr_comment' && this.gitlab) { postGitLabComment(...) }`. If the Bitbucket call were nested under that same `this.gitlab` guard, a Bitbucket comment would be **silently skipped whenever GitLab is unconfigured** (`this.gitlab` undefined). Instead, make it a single `if (output === 'pr_comment')` that delegates to a private router which dispatches by **payload shape**, each guarded only by its own client:
  ```
  if (output === 'pr_comment') {
    await this.postPrComment(run.result, payload).catch(e => console.error('[ResultDispatcher] pr_comment failed:', e));
  }
  ```
  ```
  private async postPrComment(result, payload) {
    // GitLab-shaped
    if (payload?.object_attributes?.iid && this.gitlab) { await this.postGitLabComment(result, payload); return; }
    // Bitbucket-shaped
    if (payload?.pullrequest && this.bitbucket) { await this.postBitbucketComment(result, payload); return; }
    console.warn('[ResultDispatcher] pr_comment: no matching platform client for payload shape');
  }
  ```
  (Use the repo's existing index-access/cast style — `(payload?.['object_attributes'] as Record<string, unknown>)?.['iid']`, `(payload?.['pullrequest'])` — not dotted typed access; the pseudocode above is shorthand. The trailing `console.warn` gives observability when neither shape matches or the matching client is unconfigured.)
  - `postGitLabComment` keeps its current body (just moved behind the shape check).
  - `postBitbucketComment(result, payload)`: `repo = payload.repository.full_name`, `prId = payload.pullrequest.id`; body `### Agent Hub Review\n\n${result}` → `this.bitbucket.postPrComment(repo, prId, body)`.
  - The single shape-router guarantees: only the matching client fires; a GitLab payload never hits Bitbucket and vice-versa; and Bitbucket works even when GitLab is unconfigured. The outer `.catch` log pattern is preserved.

### Wiring
- `webhooks.ts`: the shared `ContextFetcher` gains `config.BITBUCKET_API_TOKEN, config.BITBUCKET_USERNAME`.
- `runs.ts:81` (manual-run `ContextFetcher`) and `runs.ts:142` (`ResultDispatcher`): append the two Bitbucket config args.

### Local repo path (1A interplay)
An agent's `repos` entry `bitbucket:globaleteam/core` → `resolveRepoPaths` takes the last `/` segment `core` → `C:/GlobalE/core` (exists) → the agent's read-only tools work on Core locally. No change needed.

## Data flow

`pullrequest:created` POST (`/webhooks/bitbucket?token=…`, `X-Event-Key`) → token check → `parseBitbucketEvent` → `matchAgents` (agent `repos` ∋ `bitbucket:globaleteam/core`, events ∋ `mr:opened`) → `ContextFetcher` (diff + linked Jira) → run created → runner executes (1A tools read Core at `C:/GlobalE/core`) → `ResultDispatcher` `pr_comment` → `postBitbucketComment`.

## Error handling

Unmapped event / no match → 200 `{skipped}`. Bad/missing token (when secret set) → 401. Context fetch + linked-Jira are best-effort (try/catch + warn). Comment-back failure caught + logged. Bitbucket diff endpoint returning non-OK → `getPrContext` throws → caught by the fetch try/catch (run still created with whatever context exists).

## Testing (Jest)

- **`test/bitbucketParse.test.ts`** — `parseBitbucketEvent`: each event-key mapping; `bitbucket:` repo prefix from `repository.full_name`; sourceRef from `pullrequest.source.branch.name`; unmapped key → null; missing `repository.full_name` → null.
- **`test/bitbucketClient.test.ts`** — pure `bitbucketAuthHeader` (Bearer when no username; `Basic base64(user:token)` when username) and `prJsonToMrContext` (field mapping, missing description → '').
- **`test/ContextFetcher.test.ts`** (extend) — fake-inject `(f as any).bitbucket = { getPrContext: … }` + `jira.getTicket`; a `platform:'bitbucket'` event → serialized output contains the diff and the linked ticket; best-effort (getPrContext throws → no crash, no mr).
- **`test/resultDispatcherBitbucket.test.ts`** (or extend an existing dispatcher test) — `pr_comment` with a Bitbucket-shaped payload calls a fake `bitbucket.postPrComment` with the right repo/prId; a GitLab-shaped payload does NOT call the bitbucket client.
- **`test/webhooks` route auth** (if a route test harness exists; else covered by the parser + manual): 401 when secret set and token wrong/missing.

## Affected files

- `apps/server/src/config/environment.ts` (modify — 3 optional vars)
- `apps/server/src/services/BitbucketClient.ts` (new)
- `apps/server/src/services/WebhookMatcher.ts` (modify — `parseBitbucketEvent`)
- `apps/server/src/api/routes/webhooks.ts` (modify — `/webhooks/bitbucket` + ContextFetcher wiring)
- `apps/server/src/services/ContextFetcher.ts` (modify — ctor + bitbucket branch)
- `apps/server/src/services/ResultDispatcher.ts` (modify — ctor + bitbucket pr_comment route)
- `apps/server/src/api/routes/runs.ts` (modify — thread Bitbucket config into ContextFetcher + ResultDispatcher)
- tests as listed above (new + extensions)

## Deployment note

Server runs from `dist/` — `npx tsc` in `apps/server` + restart after merge. New optional env: `BITBUCKET_API_TOKEN`, `BITBUCKET_USERNAME` (only for Basic/app-password), `BITBUCKET_WEBHOOK_SECRET`; add to `.env.example`. No DB migration, no new dependencies. To activate: create a Bitbucket repo webhook for `globaleteam/core` PR events pointing at `https://<tunnel>/webhooks/bitbucket?token=<secret>`, give an agent `repos: ["bitbucket:globaleteam/core"]` + `mr:*` events + `pr_comment` output, ensure Core is checked out at `C:/GlobalE/core`.
