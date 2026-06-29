# Read-only Tool Use in the Runner Executor — Design

**Date:** 2026-06-29
**Repo:** `globale.agent-hub`
**Status:** Approved (pending spec review)
**Roadmap:** Phase 1A (see memory `agent-hub-roadmap`)

## Problem

Agent runs are effectively text-only. The runner invokes `claude -p --model … --append-system-prompt-file …` with **no** `--allowedTools` / `--permission-mode` flags, so the model can only reason over the pre-fetched `run.context` (a diff, a ticket) plus the system prompt. It cannot open files, grep, or inspect git history in the target repo. This caps quality (a reviewer can't see the code around a diff) and makes tool-referencing skills inert.

## Goal

Give agents **strict read-only** access to their own repos via Claude Code's built-in tools — on by default, with a runner kill-switch — without changing the agent schema or the client.

## Non-goals (YAGNI)

- No write/edit capability, no git worktree isolation (the deferred "read+write" option).
- No per-agent toggle / DB column / UI change — enablement is global with an env kill-switch.
- No new dependencies, no DB migration.
- No changes to context fetching itself (that is Phase 1B).

## Decisions

| Question | Decision |
|---|---|
| Tool capability | **Strict read-only**: Read, Grep, Glob, and Bash scoped to read-only git |
| Enablement | **Global, on by default**; runner env kill-switch `AGENT_TOOLS_ENABLED` (default true) |
| Filesystem scope | **Scope to the agent's repos**: cwd = first resolved repo, `--add-dir` the rest, fallback to `reposRoot` |
| Deny-list | **Explicit** `--disallowedTools Write Edit NotebookEdit` (belt-and-suspenders) in addition to the allow-list |

## Architecture

Two new **pure** helpers keep `executor.ts` focused and unit-testable; the `runClaude` spawn stays thin.

### New: `packages/runner/src/context/repoPaths.ts`
```
resolveRepoPaths(reposRoot: string, repos: string[]): string[]
```
- For each entry in `repos` (e.g. `gitlab:global-e/core/checkout/GlobalE.Core.Checkout.Apps`), take the last path segment as the repo name and resolve `join(reposRoot, name)`.
- Return the subset of those paths that **exist** on disk (via `existsSync`), de-duplicated, order-preserving.
- This is the logic currently inline in `LocalEnricher`; extract it here and have `LocalEnricher` call it (DRY, no behavior change).

### New: `packages/runner/src/toolPolicy.ts`
```
buildToolArgs(opts: { enabled: boolean; repoPaths: string[] }): string[]
```
- If `!enabled` → return `[]` (exact current behavior; back-compat).
- Else return a flag array:
  - `--permission-mode`, `default`
  - `--allowedTools`, then the allow-list tokens (see below)
  - `--disallowedTools`, then `Write Edit NotebookEdit`
  - for each path in `repoPaths.slice(1)`: `--add-dir`, `<path>`
- The **cwd** (first repo path vs `reposRoot` fallback) is decided in `runClaude`, not here — `buildToolArgs` only emits flags. `repoPaths` is passed so `--add-dir` covers the non-cwd repos.

**Allow-list tokens** (passed as separate argv items, since the CLI accepts space-separated tools):
```
Read  Grep  Glob
Bash(git log:*)  Bash(git diff:*)  Bash(git show:*)  Bash(git status:*)
Bash(git blame:*)  Bash(git ls-files:*)  Bash(git branch:*)  Bash(git rev-parse:*)
```

### Modify: `packages/runner/src/config.ts`
Add `toolsEnabled: boolean` derived from `process.env.AGENT_TOOLS_ENABLED` — **default true**; `false`/`0`/`no` (case-insensitive) → false.

### Modify: `packages/runner/src/executor.ts`
- `executeJob` parses `job.agent.repos`, calls `resolveRepoPaths(localReposRoot, repos)`, and threads the result + `toolsEnabled` into `runClaude`. (`executeJob` gains a `toolsEnabled` parameter; `poller.ts` passes `config.toolsEnabled`.)
- `runClaude(model, systemPrompt, userMessage, cwd, toolArgs)`:
  - `cwd` = `repoPaths[0]` if any resolved, else `localReposRoot` (current behavior).
  - Build argv as today plus `...toolArgs` appended after the existing flags.
  - Everything else (env strip of `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, JSON output parsing, timeout, sys-file cleanup) unchanged.

### Modify: `packages/runner/src/context/LocalEnricher.ts`
Replace its inline repoName→path resolution with a call to `resolveRepoPaths` (then read `CLAUDE.md` from the first existing path). Behavior-preserving refactor.

### Modify: `packages/runner/src/poller.ts`
Pass `config.toolsEnabled` into the `executeJob` call (one new argument).

## Data flow

`poller` claims run → `executeJob` (builds system prompt as today) → `resolveRepoPaths` → `runClaude` sets cwd to the agent's repo + appends read-only tool flags → `claude -p` runs an agentic loop able to Read/Grep/Glob/(read-only git) inside the agent's repo(s) → result returned as today, `<memory-update>` extracted as today.

## Error handling

- **No repos resolve on disk:** `repoPaths` is empty → cwd falls back to `reposRoot`, no `--add-dir`. With `toolsEnabled` true the agent still gets Read/Grep/Glob/git rooted at `reposRoot` (broad but read-only); this matches the "whole root" fallback and is never worse than today.
- **Kill-switch off:** `buildToolArgs` returns `[]`; the invocation is byte-for-byte the current text-only one.
- **A tool the model tries that isn't allow-listed:** denied by `--permission-mode default` (no TTY in `-p`); the run continues. No special handling needed.

## Risks (documented, accepted)

1. **Bash prefix-matching.** The allow-list matches command prefixes; chained/compound commands (`git log; rm -rf …`) do not match a read-only pattern and are denied. Read-only intent holds for normal (non-adversarial) agent behavior.
2. **Cost / latency / rate-limit.** Tool use makes each run a multi-turn agentic loop → more tokens, longer wall-clock, more pressure on the **shared subscription** quota (429s). Mitigation: the `AGENT_TOOLS_ENABLED` kill-switch; observe run behavior after rollout and trigger heavy agents off-peak.
3. **No write path.** Read-only built-ins cannot modify the checkout, so worktree isolation is unnecessary in this phase.

## Testing

Vitest unit tests (matching existing `test/*.test.ts` style):

- **`test/repoPaths.test.ts`** — `resolveRepoPaths`: strips `gitlab:`-style prefixes to the last segment; returns only existing dirs (use `os.tmpdir()`-created fixture dirs); preserves order; de-dupes; empty input → `[]`. (No mocking of `fs` — create real temp dirs.)
- **`test/toolPolicy.test.ts`** — `buildToolArgs`: `enabled:false` → `[]`; `enabled:true` → contains `--permission-mode default`, the full Read/Grep/Glob + read-only-git allow-list, `--disallowedTools Write Edit NotebookEdit`; one `--add-dir` per non-first repo path; zero `--add-dir` when ≤1 path.

`runClaude` (process spawn) is not unit-tested. **Manual verification** after merge: rebuild `dist`, restart the runner, trigger a real run for an agent whose repo is checked out locally, and confirm from the result that the agent read a file it was **not** handed in `context` (e.g. it cites a function defined outside the diff). Also verify `AGENT_TOOLS_ENABLED=false` reverts to text-only.

## Affected files

- `packages/runner/src/context/repoPaths.ts` (new)
- `packages/runner/src/toolPolicy.ts` (new)
- `packages/runner/src/executor.ts` (modify)
- `packages/runner/src/config.ts` (modify)
- `packages/runner/src/context/LocalEnricher.ts` (modify — DRY refactor)
- `packages/runner/src/poller.ts` (modify — pass `toolsEnabled`)
- `packages/runner/test/repoPaths.test.ts` (new)
- `packages/runner/test/toolPolicy.test.ts` (new)

## Deployment note

Runner runs from `dist/` — after merge run `npx tsc` in `packages/runner` and restart the runner process. New env var `AGENT_TOOLS_ENABLED` is optional (defaults true); add to `.env.example`. No DB migration, no new dependencies.
