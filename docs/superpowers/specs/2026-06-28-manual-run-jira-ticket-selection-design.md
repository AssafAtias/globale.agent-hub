# Manual-run Jira ticket selection for `ticket-to-code` agents

**Date:** 2026-06-28
**Repo:** globale.agent-hub
**Status:** Superseded by `2026-06-28-interactive-gated-workflow-design.md`
(the ticket-selection described here becomes "step 1" of that larger feature;
kept for reference)

## Problem

When a `ticket-to-code` agent (e.g. "Ticket-to-MR - Checkout Apps") is triggered
**manually** via `POST /api/runs`, the run is created with empty context
(`triggerPayload: '{}'`, `context: '{}'`). No Jira lookup happens, so the agent
receives its "a Jira ticket was assigned…" prompt with no actual ticket and no
way to find one — the `JiraClient` only supports `getTicket(issueKey)` and
`postComment`, and there is no JQL/search anywhere in the codebase.

Expected behaviour (manual run):
1. Search Jira for the first **Open** ticket assigned to the token owner.
2. If found, feed the ticket into the run so the agent implements it and opens a
   Draft MR (the agent prompt already owns MR creation).
3. If none found, report **"No open tasks found."**

## Decisions (confirmed)

- **Whose tasks:** token owner — JQL `assignee = currentUser()`. No extra config.
- **Run scope:** one ticket per run (first/oldest matching, `ORDER BY created ASC`).
- **Label filter:** none — status (and assignee/project) only. The webhook
  trigger's `no_monolith_impact` label filter does **not** apply to manual runs.
- **Status name:** literal `"Open"` — verified against Global-E Jira (status id 1,
  category "To Do"). JQL validated:
  `project = CORE AND assignee = currentUser() AND status = "Open" ORDER BY created ASC`.
- **Project:** defaults to `CORE`, overridable via a new optional `JIRA_PROJECT_KEY`.

## Scope

Server-side only. Three files changed + one new repo method. **No MR-creation
code** — the Draft MR is created by the runner's Claude agent (it runs with tools
in the local repo per its prompt). The downstream pipeline is untouched.

### 1. `JiraClient` — new `searchFirstOpenAssigned(projectKey = 'CORE')`

- `POST ${baseUrl}/rest/api/3/search/jql` with body
  `{ jql, maxResults: 1, fields: ['summary','description','status','labels'] }`.
- `jql = project = ${projectKey} AND assignee = currentUser() AND status = "Open" ORDER BY created ASC`.
- Maps the first issue to the existing `JiraTicketContext` (reuse
  `extractDescription`). Returns `null` when `issues` is empty.
- Auth/header pattern follows the existing methods (`Bearer ${token}`).

### 2. `ContextFetcher` — new `fetchOpenAssignedTicket(projectKey?)`

- Calls `searchFirstOpenAssigned`; returns `FetchedContext`
  (`{ rawPayload: {}, ticket }`) when found, or `null`.
- Returns `null` (not throw) when Jira is not configured, so the caller can
  distinguish "not configured" from "found/none". (Caller checks config first.)
- Keeps context-shaping centralized: the manual run serializes through the same
  `serializeForRunner` the webhook path uses, so the runner sees identical
  `Jira Ticket` / `Status` / `Description` sections.

### 3. `POST /api/runs` (runs.ts) — branch on `agent.type === 'ticket-to-code'`

Current behaviour is preserved for all other agent types (empty context).

For `ticket-to-code`:
- If `JIRA_API_TOKEN` / `JIRA_BASE_URL` are not configured → `400` with a clear
  message ("Jira is not configured; cannot search for tickets").
- Build a `ContextFetcher` and call `fetchOpenAssignedTicket()`:
  - **Found** → create the run with
    `context = fetcher.serializeForRunner(ctx)` and
    `triggerPayload = JSON.stringify({ issue: { key: ctx.ticket.key } })`
    (so the run record shows which ticket). Return `201` with the run.
    Existing flow proceeds; the runner's Claude opens the Draft MR.
  - **None** → create an **immediately-completed** run via new
    `RunRepository.createCompleted({ agentId, trigger:'manual', result:'No open tasks found.' })`.
    Return `201` with that run. It shows on the dashboard, and being created in
    `done` status it is never claimable by the runner (no race).

### 4. `RunRepository.createCompleted(...)` — new method

Inserts a run directly in `status: 'done'` with `result` set and
`createdAt`/`startedAt`/`finishedAt` stamped. Mirrors `create` but skips the
`pending` state so the runner long-poll (`claimNext`) cannot pick it up.

## Data flow (manual run, ticket-to-code)

```
client useTriggerRun → POST /api/runs { agentId }
  └─ agent.type === 'ticket-to-code'
       ├─ Jira not configured → 400
       ├─ ContextFetcher.fetchOpenAssignedTicket()
       │     └─ JiraClient.searchFirstOpenAssigned('CORE')
       │           └─ POST /rest/api/3/search/jql (maxResults 1)
       ├─ ticket found → RunRepository.create(context, triggerPayload) → 201 (pending)
       │     └─ runner claims → executor → claude -p (opens Draft MR)
       └─ none → RunRepository.createCompleted('No open tasks found.') → 201 (done)
```

## Testing

- `JiraClient.searchFirstOpenAssigned`: mock `fetch` → maps an issue; returns
  `null` on empty `issues`; throws on non-OK response.
- `ContextFetcher.fetchOpenAssignedTicket`: returns context when ticket found;
  returns `null` when none / when Jira not configured.
- `runs.ts` manual trigger:
  - ticket-to-code + ticket found → pending run created with ticket context and
    `triggerPayload.issue.key` set.
  - ticket-to-code + none → completed run with `result: 'No open tasks found.'`,
    status `done`.
  - ticket-to-code + Jira unconfigured → `400`.
  - non-ticket-to-code agent → unchanged (empty context, pending run).
- `RunRepository.createCompleted`: inserts a `done` run not returned by
  `claimNext`.

## Out of scope

- **Draft MR creation** — already the runner agent's responsibility (prompt:
  "open a Draft MR"). This change only guarantees the ticket reaches the agent.
- **Webhook trigger behaviour** — unchanged.
- **`mr` / `jira_comment` ResultDispatcher outputs** — still "phase 2"; a
  separate concern.
- **Hardening the agent prompt** to explicitly require `glab mr create --draft` —
  optional follow-up, not part of this code change.

## Risks

- The runner's Claude must have git/glab tooling and the repo cloned at
  `LOCAL_REPOS_ROOT` for the Draft MR step to succeed. Feeding the ticket is
  necessary but not sufficient — MR success depends on the runner environment.
- `currentUser()` resolves to whoever owns the runner's `JIRA_API_TOKEN`, which
  may differ from the dashboard operator. Documented; acceptable per decision.
- The `/rest/api/3/search/jql` endpoint is the current enhanced-search endpoint;
  if the deployed Jira instance differs, the search call must be adjusted.
