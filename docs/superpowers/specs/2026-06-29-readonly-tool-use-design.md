# Read-only Tool Use in the Runner Executor — Design

**Date:** 2026-06-29
**Repo:** `globale.agent-hub`
**Status:** In Review
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
- Return the subset of those paths whose **directory** exists (`existsSync(dirPath)`), de-duplicated, order-preserving. Empty input or none-exist → `[]`.
- **`LocalEnricher` refactor — preserve semantics exactly.** `LocalEnricher` today checks `existsSync(claudeMd)` (a FILE), not the directory, and reads/slices the first `CLAUDE.md` it finds. After the refactor it must call `resolveRepoPaths(reposRoot, repos)` to get existing repo **dirs**, then for each returned dir do its OWN `existsSync(join(dir, 'CLAUDE.md'))` check, reading+slicing the first hit and breaking. Do NOT assume a returned dir has a `CLAUDE.md`; the file check stays in `LocalEnricher`. This keeps current behavior (a repo dir with no `CLAUDE.md` simply yields no injected `CLAUDE.md`, as today).

### New: `packages/runner/src/toolPolicy.ts`
```
buildToolArgs(opts: { enabled: boolean; repoPaths: string[] }): string[]
```
- If `!enabled` → return `[]` (exact current behavior; back-compat).
- Else return a flag array, in this exact order so each variadic flag is
  terminated by the next flag:
  `--permission-mode default --allowedTools <allow-tokens…> --disallowedTools "Write" "Edit" "NotebookEdit" --add-dir "<path>"…`
  where the trailing `--add-dir "<path>"` is repeated **once per path in `repoPaths.slice(1)`** (the non-cwd repos). When `repoPaths.length <= 1`, no `--add-dir` is emitted.
- The **cwd** (first repo path vs `reposRoot` fallback) is decided in `runClaude`, not here — `buildToolArgs` only emits flags. `repoPaths` is passed so `--add-dir` covers the non-cwd repos.

**SHELL QUOTING (required — `runClaude` spawns with `shell: true`).** Because the
child is spawned through the shell (`shell: true`, needed on Windows to resolve
the `claude.cmd` shim), every emitted token that contains a space, parenthesis,
`*`, or `:` would be mangled by `cmd.exe` if passed bare. Therefore
`buildToolArgs` MUST wrap **every** allow-list/deny-list token and every
`--add-dir` path in double quotes — exactly as the existing code already does for
the sys-prompt file (`"${sysFile}"`). The bare flag names (`--permission-mode`,
`--allowedTools`, `--disallowedTools`, `--add-dir`) and the value `default` are
not quoted.

**Exact returned `string[]`** for `enabled:true`, `repoPaths = ['C:/GlobalE/Apps','C:/GlobalE/core']`:
```js
[
  '--permission-mode', 'default',
  '--allowedTools',
    '"Read"', '"Grep"', '"Glob"',
    '"Bash(git log:*)"', '"Bash(git diff:*)"', '"Bash(git show:*)"', '"Bash(git status:*)"',
    '"Bash(git blame:*)"', '"Bash(git ls-files:*)"', '"Bash(git branch:*)"', '"Bash(git rev-parse:*)"',
  '--disallowedTools', '"Write"', '"Edit"', '"NotebookEdit"',
  '--add-dir', '"C:/GlobalE/core"',
]
```
(The first repo `C:/GlobalE/Apps` becomes `cwd` in `runClaude`, so it is NOT in `--add-dir`.) For `enabled:false` → `[]`.

### Modify: `packages/runner/src/config.ts`
Add `toolsEnabled: boolean` derived from `process.env.AGENT_TOOLS_ENABLED` — **default true**; `false`/`0`/`no` (case-insensitive) → false.
**Leave the existing `anthropicApiKey: required('ANTHROPIC_API_KEY')` as-is** — the runner still requires it at startup (it is stripped from the *child* env in `runClaude`, but config validation is unchanged). Do not remove the `required()` call.

### Modify: `packages/runner/src/executor.ts`
New explicit signatures (the only changes are the added trailing params):

```ts
export async function executeJob(
  job: Job, localReposRoot: string, skillsDir: string, workflowsDir: string,
  memory: MemoryInput, toolsEnabled: boolean,
): Promise<{ result: string; note: string | null }>

async function runClaude(
  model: string, systemPrompt: string, userMessage: string, cwd: string, toolArgs: string[],
): Promise<string>
```

- In `executeJob`: parse `job.agent.repos` (reuse the existing safe-parse), call
  `const repoPaths = resolveRepoPaths(localReposRoot, repos)`, compute
  `const cwd = repoPaths[0] ?? localReposRoot`, and
  `const toolArgs = buildToolArgs({ enabled: toolsEnabled, repoPaths })`. Then
  `runClaude(job.agent.model, systemPrompt, contextText, cwd, toolArgs)`.
- In `runClaude`: the `spawn` args become the current fixed flags **plus** `...toolArgs` appended after `--append-system-prompt-file "<sysFile>"`. `cwd` is the passed value (no longer hard-wired to `localReposRoot`). Everything else (env strip of `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, `shell: true`, JSON output parsing, 10-min timeout, sys-file cleanup) unchanged.

### Modify: `packages/runner/src/poller.ts`
The `executeJob` call (currently line ~68) gains `config.toolsEnabled` as the **6th** argument:
```ts
const { result, note } = await executeJob(
  job, config.localReposRoot, config.skillsDir, config.workflowsDir, memory, config.toolsEnabled,
);
```

### Modify: `packages/runner/src/context/LocalEnricher.ts`
Replace its inline repoName→path resolution with a call to `resolveRepoPaths` (see the semantics-preserving instructions in the `repoPaths.ts` section above — `LocalEnricher` keeps its own `existsSync(claudeMd)` file check).

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

- **`test/repoPaths.test.ts`** — `resolveRepoPaths`, using real temp dirs created with `mkdtempSync` and removed in a `finally` block (matching `SkillLoader.test.ts`/`WorkflowLoader.test.ts` style): strips `gitlab:`-style prefixes to the last segment; returns only paths whose directory exists; preserves order; **de-dupes** (input `['gitlab:x/Apps','gitlab:y/Apps']` resolving to the same existing dir → one entry); empty input → `[]`; none-exist → `[]`. (No mocking of `fs`.)
- **`test/toolPolicy.test.ts`** — `buildToolArgs`: `enabled:false` → `[]`; `enabled:true` returns the **exact array shape** shown in the toolPolicy section, including the **double-quoted** tokens (assert `args` contains `'"Bash(git log:*)"'` and `'"Read"'`, NOT bare `'Read'`); `--permission-mode default` present; `--disallowedTools` followed by `'"Write"' '"Edit"' '"NotebookEdit"'`; exactly one `--add-dir "<path>"` per non-first repo path (assert count); zero `--add-dir` when `repoPaths.length <= 1`.

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

Runner runs from `dist/` — after merge run `npx tsc` in `packages/runner` and restart the runner process. No DB migration, no new dependencies.

**Opt-out-required rollout (flag this):** because `toolsEnabled` defaults **true**, the moment a runner is rebuilt from `dist` and restarted it switches from text-only to agentic tool use — no env change needed to activate it. To keep the old behavior, set `AGENT_TOOLS_ENABLED=false` *before* restarting. Add `AGENT_TOOLS_ENABLED` (commented, with the default noted) to `.env.example`.
