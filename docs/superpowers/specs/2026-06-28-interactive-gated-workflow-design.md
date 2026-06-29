# Interactive gated workflow execution for `ticket-to-code` agents

**Date:** 2026-06-28
**Repo:** globale.agent-hub
**Status:** Approved (design)
**Supersedes:** `2026-06-28-manual-run-jira-ticket-selection-design.md`
(that spec's ticket-selection becomes "step 1" of this feature)

## Problem

Two gaps make the "Ticket-to-MR - Checkout Apps" agent behave differently from
what the operator expects:

1. **Manual runs carry no ticket.** `POST /api/runs` creates a run with empty
   context; the `JiraClient` has no JQL/search, so a manual run gives the agent
   its "a ticket was assigned…" prompt with no ticket and no way to find one.

2. **The workflow's gates are not in effect.** `workflows/jira-ticket-to-mr.md`
   defines golden rules and ⛔ gates ("only `Open` tickets", "stop at every gate
   and wait for the user", "MR is always a draft, verify `draft:true`"), but:
   - the workflow file is **never loaded** — not referenced by the agent's
     prompt, not in `SKILLS_DIR`, not read by any runtime code;
   - the agent's `skills` tags (`Jira`, `GitLab`, …) **resolve to nothing** in
     `SkillLoader`, so even they contribute nothing;
   - the runner executes `claude -p` **headless/single-shot**, so the workflow's
     interactive "wait for the user" gates could not function even if injected.

   So the agent's real runtime system prompt is just the memory instruction + one
   prompt sentence; every gate is unenforced.

## Goal

Make the workflow's gates genuinely interactive and enforced, in a way
compatible with the headless CLI runner, and feed manual runs a real ticket.

## Approach (decided)

**Approach A — session-resume state machine.** The CLI (v2.1.190) supports
`--session-id <uuid>` and `--resume <uuid>` with `--print`, so one agent
conversation can span multiple invocations. The agent pauses at a gate by
emitting a `<gate>…</gate>` block (mirroring the existing `<memory-update>`
convention); the run parks in `waiting_approval`; the operator responds on the
dashboard; the runner resumes the same session with the reply. Keeps the CLI
subscription-auth model the executor deliberately relies on
([executor.ts:88-96](../../packages/runner/src/executor.ts#L88)).

Rejected: **B** (server step machine — rebuilds a workflow engine, can't
serialize the implement step's working tree); **C** (Agent SDK rewrite — loses
CLI auth/token-refresh handling, biggest risk).

## Decisions (confirmed)

From the ticket-selection spec (still in force):
- Manual selection JQL: `assignee = currentUser()` (token owner), one ticket
  (`ORDER BY created ASC`), **no** label filter, status literal `"Open"`
  (verified id 1), project defaults to `CORE` (override `JIRA_PROJECT_KEY`).

New for the interactive feature:
- Gates run via session resume; the agent decides when to gate, driven by the
  injected workflow markdown.
- Workflow is attached to an agent via a new nullable `workflow` column.

## Run lifecycle

```
pending → running → waiting_approval → pending → running → … → done
                          │                                      ├ failed
                          └────────── (user rejects) ───────────→ rejected
```

The executor distinguishes a fresh run (no `sessionId`) from a resume (has
`sessionId` + `pendingResponse`).

## Components

### 1. DB migration — new nullable columns on `runs`

Backward-compatible (all nullable, no backfill):
- `sessionId TEXT` — claude session UUID, set by the runner on first execution.
- `pendingGate TEXT` — JSON `{id, summary, question, kind, options?}` while
  `waiting_approval`; null otherwise.
- `pendingResponse TEXT` — the user's reply to feed on resume; nulled at claim
  time after capture.

Follow the existing Drizzle migration pattern (see `migration.test.ts`).

### 2. New nullable column on `agents`

- `workflow TEXT` — basename of a workflow file (e.g. `jira-ticket-to-mr`), or
  null. Seed the Ticket-to-MR agent with `jira-ticket-to-mr`.

### 3. Gate protocol + workflow injection (executor)

Executor builds the system prompt with, in order: skills (unchanged) → memory →
**protocol preamble** → **workflow markdown** → agent prompt.

Protocol preamble (verbatim intent):
> Each turn is non-interactive. When the workflow says STOP at a ⛔ gate, end your
> turn with exactly one `<gate>{...}</gate>` JSON block and stop — do not proceed
> past it. You will be re-invoked with the user's response and continue. JSON
> shape: `{ "id": string, "summary": string, "question": string, "kind":
> "approve_reject" | "input" | "choice", "options"?: string[] }`. When fully done
> (MR opened, or stopped for a non-code ticket), end normally with no gate block.

Workflow loading: new `WorkflowLoader` (runner) reads
`<workflowsDir>/<name>.md`, strips frontmatter if any, injects the **full**
content (no `SkillLoader` 6 000-char cap — the workflow is ~5.9 KB).
`workflowsDir` default `C:/GlobalE/globale.agent-hub/workflows`, override
`WORKFLOWS_DIR`.

Output parsing: after each `claude` run, scan for `<gate>…</gate>`:
- present → `{ kind: 'gate', gate, sessionId }` (validate JSON; malformed gate →
  treat as `failed` with a clear error).
- absent → `{ kind: 'final', result, note }` (existing `extractMemoryUpdate`).

### 4. Executor / runner changes

- `Job` + `isJob`: add optional `run.sessionId`, `run.pendingResponse`.
- Fresh: `sessionId = randomUUID()`, spawn `claude -p --session-id <uuid> …`,
  stdin = serialized context (today's behaviour).
- Resume: spawn `claude -p --resume <run.sessionId> …`, stdin = the user's reply
  rendered to text (e.g. `User approved.` / `User answer: <message>`).
- Never pass `--no-session-persistence`.
- Poller: a `gate` outcome → `POST /api/runs/:id/result { gate, sessionId }`;
  a `final` outcome → existing `{ result }`; error → `{ error }`.

### 5. Server API

- `POST /api/runs` (manual trigger) — for `agent.type === 'ticket-to-code'`,
  perform the JQL ticket selection from the superseded spec (JiraClient
  `searchFirstOpenAssigned` + `ContextFetcher.fetchOpenAssignedTicket`): ticket
  found → create run with context + `triggerPayload={issue:{key}}`; none →
  `RunRepository.createCompleted('No open tasks found.')`; Jira unconfigured →
  400. Other agent types unchanged.
- `POST /api/runs/:id/result` — accept `{ result?, error?, gate?, sessionId? }`.
  `gate` present → `RunRepository.pauseForGate(id, sessionId, gate)`. Else
  existing complete/fail, persisting `sessionId`.
- **New** `POST /api/runs/:id/respond` `{ decision: 'approve'|'reject'|'answer',
  message? }` — only valid when status is `waiting_approval` (else 409).
  `reject` → `RunRepository.reject(id, message)` (terminal). Else
  `RunRepository.resumeWithResponse(id, {decision, message})` → status `pending`.
- `GET /api/runs/next` — unchanged claim, but the route includes
  `sessionId`/`pendingResponse` in the returned job.

### 6. RunRepository

- `create` — `sessionId` defaults null.
- `createCompleted({agentId, trigger, result})` — inserts directly in `done`
  (never `pending`, so `claimNext` can't grab it). Used for "No open tasks found".
- `pauseForGate(id, sessionId, gateJson)` → `waiting_approval`, set `sessionId` +
  `pendingGate`, clear `runnerId`.
- `resumeWithResponse(id, responseJson)` → `pending`, set `pendingResponse`,
  clear `pendingGate`.
- `reject(id, message)` → `rejected`, set `error`=message, `finishedAt`.
- `claimNext` — capture `pendingResponse` into the returned row, null the column
  in the same transaction.
- `complete`/`fail` — persist `sessionId` when provided.

### 7. Client UI

- Run detail: when `waiting_approval`, render `pendingGate.summary` +
  `question`; controls = Approve / Reject, plus a text input for `input`/`choice`
  kinds (and option buttons for `choice`). Submit → `POST /api/runs/:id/respond`,
  then invalidate `['runs']`.
- `dashboard.ts`: map `waiting_approval → 'waiting'` card state; add a `rejected`
  badge. Extend `client.ts` API with `runs.respond(id, body)`.

### 8. Step-1 reconciliation

Server JQL guarantees Open + assigned + single ticket before any run cost, so
the workflow's step-1 status gate is redundant for *selection*; it degrades to a
"confirm you understood the ticket" gate. Steps 2-6 (classify → clarify →
confirm target → implement + diff approval → draft MR w/ `draft:true` check)
become real gates.

## Data flow (manual run, happy path)

```
client → POST /api/runs {agentId}
  └─ ticket-to-code → JQL select first Open assigned ticket
       ├─ none → createCompleted("No open tasks found") → done
       └─ found → create run (context + issue key) → pending
runner claimNext → executor (fresh): claude -p --session-id <uuid>
  agent works → emits <gate> (e.g. confirm target repo/branch)
  executor → POST /result {gate, sessionId} → waiting_approval
dashboard shows gate → user Approves → POST /respond → pending (pendingResponse set)
runner claimNext → executor (resume): claude -p --resume <uuid> "<reply>"
  … repeat per gate … → final turn opens draft MR, no gate → POST /result {result} → done
```

## Testing

- `JiraClient.searchFirstOpenAssigned` — maps issue / null on empty / throws on
  non-OK.
- `ContextFetcher.fetchOpenAssignedTicket` — context vs null (incl. unconfigured).
- `WorkflowLoader` — loads full markdown by name; missing file → empty/skip.
- Executor gate parsing — detects `<gate>`, validates JSON, malformed → error;
  no gate → final (memory-update still extracted).
- Executor resume — builds `--resume <id>` with reply when `sessionId` present;
  `--session-id <new>` when fresh.
- `RunRepository` — `pauseForGate`, `resumeWithResponse`, `reject`,
  `createCompleted` (not claimable), `claimNext` clears `pendingResponse`.
- `runs.ts` — `/respond` only from `waiting_approval` (409 otherwise); reject is
  terminal; `/result` with gate → `waiting_approval`; manual trigger branches
  (found / none / unconfigured / non-ticket-to-code).
- Migration test — new columns present, existing rows readable.

## Out of scope

- Concurrent interactive runs on the same repo (working-tree collision). MVP
  assumes serialized runs per repo; future fix = per-run git worktree.
- Auto-timeout / expiry of `waiting_approval` runs.
- `mr` / `jira_comment` `ResultDispatcher` outputs (still "phase 2").
- Migrating the webhook trigger to the gated model (webhook path unchanged;
  gates apply to the agent regardless of trigger, but webhook runs have no human
  to answer gates — documented limitation, not addressed here).

## Risks

- **Working-tree persistence** between pause/resume relies on serialized runs per
  repo. Concurrent same-repo runs collide.
- **Session continuity** depends on CLI session persistence; a long-parked run's
  session could be pruned. No retry/expiry handling in MVP.
- **Webhook-triggered runs** that hit a gate will park in `waiting_approval` with
  no operator watching. Acceptable for now (manual runs are the target use case).
- A gate the agent never emits (it ignores the protocol) silently runs to
  completion without gating — mitigated by a strong protocol preamble and by the
  server still enforcing Open-only selection.
