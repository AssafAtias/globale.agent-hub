# Read-only Tool Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agent runs strict read-only access to their own repos via Claude Code's built-in tools, scoped to the agent's checked-out repos, on by default with a runner kill-switch.

**Architecture:** Two new pure helpers (`repoPaths.ts`, `toolPolicy.ts`) keep the spawn logic thin and unit-testable; `executor.ts` sets the child `cwd` to the agent's repo and appends read-only tool flags to the `claude -p` invocation; a new `toolsEnabled` config flag (default true) gates it.

**Tech Stack:** Node + TypeScript (`packages/runner`), Vitest tests, the `claude` CLI (v2.1.190) driven via `child_process.spawn` with `shell: true`.

## Global Constraints

- Tools are **strict read-only**: only `Read`, `Grep`, `Glob`, and `Bash(git …:*)` read-only git subcommands; explicit `--disallowedTools Write Edit NotebookEdit`.
- Permission mode is `default` (headless `-p` has no TTY → unlisted tools are denied without prompting).
- **Shell quoting (required):** the spawn uses `shell: true`, so every tool token and every `--add-dir` path emitted by `buildToolArgs` MUST be double-quoted (`"Bash(git log:*)"`), matching the existing `"${sysFile}"` quoting. Bare flag names and the value `default` are not quoted.
- Enablement is **global, on by default**; `AGENT_TOOLS_ENABLED` (`false`/`0`/`no`, case-insensitive) disables it → `buildToolArgs` returns `[]` → byte-for-byte the current text-only invocation.
- Filesystem scope = the agent's resolved repos: `cwd` = first resolved repo, `--add-dir` each additional, fallback to `localReposRoot` when none resolve.
- No DB migration, no new dependencies, no client/schema change. `config.ts`'s `required('ANTHROPIC_API_KEY')` stays as-is.
- Imports use `.js` extensions (NodeNext). Existing tests use Vitest with real temp dirs (`mkdtempSync` + `rmSync` in `finally`).
- Spec: `docs/superpowers/specs/2026-06-29-readonly-tool-use-design.md`.

---

### Task 1: `resolveRepoPaths` helper + LocalEnricher refactor

**Files:**
- Create: `packages/runner/src/context/repoPaths.ts`
- Modify: `packages/runner/src/context/LocalEnricher.ts`
- Test: `packages/runner/test/repoPaths.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveRepoPaths(reposRoot: string, repos: string[]): string[]` — maps each repo (last path segment as name) to `join(reposRoot, name)`, returns those whose directory exists, de-duplicated and order-preserving.

- [ ] **Step 1: Write the failing test**

Create `packages/runner/test/repoPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveRepoPaths } from '../src/context/repoPaths.js';

describe('resolveRepoPaths', () => {
  it('resolves gitlab-style repo strings to existing dirs by last segment', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      const out = resolveRepoPaths(root, ['gitlab:global-e/core/checkout/Apps']);
      expect(out).toEqual([join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('omits repos whose directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      const out = resolveRepoPaths(root, ['gitlab:x/Apps', 'gitlab:x/Missing']);
      expect(out).toEqual([join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('preserves order and de-dupes repos resolving to the same dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'rp-'));
    try {
      mkdirSync(join(root, 'Apps'));
      mkdirSync(join(root, 'core'));
      const out = resolveRepoPaths(root, ['gitlab:a/core', 'gitlab:b/Apps', 'gitlab:c/Apps']);
      expect(out).toEqual([join(root, 'core'), join(root, 'Apps')]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('returns [] for empty input', () => {
    expect(resolveRepoPaths('/whatever', [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runner && npx vitest run test/repoPaths.test.ts`
Expected: FAIL — cannot resolve `../src/context/repoPaths.js`.

- [ ] **Step 3: Create the helper**

Create `packages/runner/src/context/repoPaths.ts`:

```ts
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolve an agent's `repos` entries (e.g. "gitlab:global-e/core/checkout/Apps")
 * to local directory paths under `reposRoot`, keeping only those that exist.
 * De-duplicated and order-preserving.
 */
export function resolveRepoPaths(reposRoot: string, repos: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const repo of repos) {
    const name = repo.split('/').pop() ?? repo;
    const path = join(reposRoot, name);
    if (seen.has(path)) continue;
    seen.add(path);
    if (existsSync(path)) result.push(path);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runner && npx vitest run test/repoPaths.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Refactor LocalEnricher to use it (behavior-preserving)**

Replace the body of `packages/runner/src/context/LocalEnricher.ts` with:

```ts
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveRepoPaths } from './repoPaths.js';

export class LocalEnricher {
  constructor(private reposRoot: string) {}

  enrich(contextStr: string, repos: string[]): string {
    const ctx = (() => { try { return JSON.parse(contextStr || '{}') as Record<string, string>; } catch { return {} as Record<string, string>; } })();
    for (const repoPath of resolveRepoPaths(this.reposRoot, repos)) {
      const claudeMd = join(repoPath, 'CLAUDE.md');
      if (existsSync(claudeMd)) {
        ctx['CLAUDE.md'] = readFileSync(claudeMd, 'utf-8').slice(0, 8000);
        break;
      }
    }
    return JSON.stringify(ctx);
  }
}
```

This keeps the existing behavior: it still reads the first `CLAUDE.md` found (its own `existsSync(claudeMd)` file check is retained); a repo dir without a `CLAUDE.md` simply yields no injection.

- [ ] **Step 6: Verify existing LocalEnricher behavior still compiles + tests pass**

Run: `cd packages/runner && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all existing runner tests still pass (plus the new `repoPaths` tests).

- [ ] **Step 7: Commit**

```bash
git add packages/runner/src/context/repoPaths.ts packages/runner/src/context/LocalEnricher.ts packages/runner/test/repoPaths.test.ts
git commit -m "feat(runner): add resolveRepoPaths helper, reuse in LocalEnricher"
```

---

### Task 2: `buildToolArgs` (tool policy)

**Files:**
- Create: `packages/runner/src/toolPolicy.ts`
- Test: `packages/runner/test/toolPolicy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildToolArgs(opts: { enabled: boolean; repoPaths: string[] }): string[]` — returns `[]` when disabled, else the read-only flag array (permission-mode + double-quoted allow/deny tokens + one `--add-dir "<path>"` per non-first repo path).

- [ ] **Step 1: Write the failing test**

Create `packages/runner/test/toolPolicy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildToolArgs } from '../src/toolPolicy.js';

describe('buildToolArgs', () => {
  it('returns [] when disabled', () => {
    expect(buildToolArgs({ enabled: false, repoPaths: ['/a', '/b'] })).toEqual([]);
  });

  it('emits permission-mode default and double-quoted read-only tools', () => {
    const args = buildToolArgs({ enabled: true, repoPaths: ['/a'] });
    expect(args.slice(0, 2)).toEqual(['--permission-mode', 'default']);
    expect(args).toContain('--allowedTools');
    expect(args).toContain('"Read"');
    expect(args).toContain('"Grep"');
    expect(args).toContain('"Glob"');
    expect(args).toContain('"Bash(git log:*)"');
    expect(args).toContain('"Bash(git rev-parse:*)"');
    // never bare
    expect(args).not.toContain('Read');
    expect(args).not.toContain('Bash(git log:*)');
  });

  it('explicitly disallows Write/Edit/NotebookEdit (quoted)', () => {
    const args = buildToolArgs({ enabled: true, repoPaths: ['/a'] });
    const i = args.indexOf('--disallowedTools');
    expect(i).toBeGreaterThan(-1);
    expect(args.slice(i + 1, i + 4)).toEqual(['"Write"', '"Edit"', '"NotebookEdit"']);
  });

  it('adds one --add-dir per NON-first repo path, quoted', () => {
    const args = buildToolArgs({ enabled: true, repoPaths: ['/a', '/b', '/c'] });
    const addDirs = args.filter((a) => a === '--add-dir');
    expect(addDirs).toHaveLength(2);
    expect(args).toContain('"/b"');
    expect(args).toContain('"/c"');
    expect(args).not.toContain('"/a"'); // first repo is the cwd, not an --add-dir
  });

  it('emits no --add-dir when one or zero repo paths', () => {
    expect(buildToolArgs({ enabled: true, repoPaths: ['/a'] }).filter((a) => a === '--add-dir')).toHaveLength(0);
    expect(buildToolArgs({ enabled: true, repoPaths: [] }).filter((a) => a === '--add-dir')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/runner && npx vitest run test/toolPolicy.test.ts`
Expected: FAIL — cannot resolve `../src/toolPolicy.js`.

- [ ] **Step 3: Implement the helper**

Create `packages/runner/src/toolPolicy.ts`:

```ts
export interface ToolArgsOptions {
  enabled: boolean;
  repoPaths: string[];
}

// Read-only built-ins + read-only git subcommands only.
const ALLOWED_TOOLS = [
  'Read', 'Grep', 'Glob',
  'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git status:*)',
  'Bash(git blame:*)', 'Bash(git ls-files:*)', 'Bash(git branch:*)', 'Bash(git rev-parse:*)',
];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// The spawn uses shell:true, so tokens with spaces/parens/globs/colons must be
// double-quoted (the shell strips the quotes before the arg reaches `claude`).
const q = (s: string): string => `"${s}"`;

export function buildToolArgs({ enabled, repoPaths }: ToolArgsOptions): string[] {
  if (!enabled) return [];
  const args: string[] = [
    '--permission-mode', 'default',
    '--allowedTools', ...ALLOWED_TOOLS.map(q),
    '--disallowedTools', ...DISALLOWED_TOOLS.map(q),
  ];
  for (const path of repoPaths.slice(1)) {
    args.push('--add-dir', q(path));
  }
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/runner && npx vitest run test/toolPolicy.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/runner/src/toolPolicy.ts packages/runner/test/toolPolicy.test.ts
git commit -m "feat(runner): add read-only buildToolArgs tool policy"
```

---

### Task 3: Wire config + executor + poller

**Files:**
- Modify: `packages/runner/src/config.ts`
- Modify: `packages/runner/src/executor.ts`
- Modify: `packages/runner/src/poller.ts:68`
- Modify: `packages/runner/.env.example` (if present; create the line if the file exists)

**Interfaces:**
- Consumes: `resolveRepoPaths` (Task 1), `buildToolArgs` (Task 2).
- Produces: `executeJob(job, localReposRoot, skillsDir, workflowsDir, memory, toolsEnabled)` and `runClaude(model, systemPrompt, userMessage, cwd, toolArgs)` — the end-to-end wiring. No further tasks depend on this.

- [ ] **Step 1: Add `toolsEnabled` to config**

In `packages/runner/src/config.ts`, add to the `RunnerConfig` interface (after `workflowsDir`):

```ts
  toolsEnabled: boolean;
```

And in the returned object in `loadConfig()` (after the `workflowsDir` line), add:

```ts
    toolsEnabled: !['false', '0', 'no'].includes((process.env.AGENT_TOOLS_ENABLED ?? '').trim().toLowerCase()),
```

Leave `anthropicApiKey: required('ANTHROPIC_API_KEY')` unchanged.

- [ ] **Step 2: Update the executor imports and signatures**

In `packages/runner/src/executor.ts`, add imports near the existing context imports (top of file):

```ts
import { resolveRepoPaths } from './context/repoPaths.js';
import { buildToolArgs } from './toolPolicy.js';
```

Change the `executeJob` signature to add the 6th parameter:

```ts
export async function executeJob(
  job: Job, localReposRoot: string, skillsDir: string, workflowsDir: string,
  memory: MemoryInput, toolsEnabled: boolean,
): Promise<{ result: string; note: string | null }> {
```

- [ ] **Step 3: Compute repo paths, cwd, and tool args in executeJob**

In `executeJob`, the existing final two lines are:

```ts
  const raw = await runClaude(job.agent.model, systemPrompt, contextText, localReposRoot);
  return extractMemoryUpdate(raw);
```

Replace them with:

```ts
  const repoPaths = resolveRepoPaths(localReposRoot, agentRepos);
  const cwd = repoPaths[0] ?? localReposRoot;
  const toolArgs = buildToolArgs({ enabled: toolsEnabled, repoPaths });

  const raw = await runClaude(job.agent.model, systemPrompt, contextText, cwd, toolArgs);
  return extractMemoryUpdate(raw);
```

(`agentRepos` already exists earlier in `executeJob` — it is parsed from `job.agent.repos` for the enricher. Reuse it.)

- [ ] **Step 4: Update runClaude to accept and append tool args**

In `packages/runner/src/executor.ts`, change the `runClaude` signature:

```ts
async function runClaude(
  model: string, systemPrompt: string, userMessage: string, cwd: string, toolArgs: string[],
): Promise<string> {
```

In its `spawn` call, change the args array from:

```ts
        ['-p', '--model', model, '--output-format', 'json', '--append-system-prompt-file', `"${sysFile}"`],
```

to:

```ts
        ['-p', '--model', model, '--output-format', 'json', '--append-system-prompt-file', `"${sysFile}"`, ...toolArgs],
```

Everything else in `runClaude` (the `cwd` is now the passed parameter; env strip of `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`; `shell: true`; JSON parsing; timeout; sys-file cleanup) is unchanged.

- [ ] **Step 5: Update the poller call site**

In `packages/runner/src/poller.ts`, change line 68 from:

```ts
        const { result, note } = await executeJob(job, config.localReposRoot, config.skillsDir, config.workflowsDir, memory);
```

to:

```ts
        const { result, note } = await executeJob(job, config.localReposRoot, config.skillsDir, config.workflowsDir, memory, config.toolsEnabled);
```

- [ ] **Step 6: Document the env var**

If `packages/runner/.env.example` exists, append:

```
# Read-only repo tools for agent runs (Read/Grep/Glob/read-only git). Default: on.
# Set to false to revert to text-only runs.
# AGENT_TOOLS_ENABLED=true
```

If the file does not exist, skip this step (do not create it).

- [ ] **Step 7: Typecheck and run the full runner suite**

Run: `cd packages/runner && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all runner tests pass (existing + `repoPaths` + `toolPolicy`).

- [ ] **Step 8: Commit**

```bash
git add packages/runner/src/config.ts packages/runner/src/executor.ts packages/runner/src/poller.ts
git add packages/runner/.env.example 2>/dev/null || true
git commit -m "feat(runner): wire read-only tool use into executor (AGENT_TOOLS_ENABLED, default on)"
```

- [ ] **Step 9: Manual verification (controller-run, post-merge)**

Not an automated test — the spawn isn't unit-tested. After merge: rebuild (`cd packages/runner && npx tsc`) and restart the runner. Trigger a real run for an agent whose `repos` dir is checked out locally, and confirm from the result that the agent referenced code it was NOT handed in `context` (e.g. it cites a function defined outside the diff). Then confirm `AGENT_TOOLS_ENABLED=false` + restart reverts to text-only output. Record the outcome in the progress ledger.

---

## Self-Review Notes

- **Spec coverage:** read-only allow/deny tokens (Task 2), shell-quoting (Task 2 `q`), permission-mode default (Task 2), kill-switch default-on (Task 1 config + Task 2 `enabled:false`→[]), repo scope cwd/add-dir + fallback (Task 3 Step 3), LocalEnricher semantics-preserving refactor (Task 1 Step 5), ANTHROPIC_API_KEY untouched (Task 3 Step 1), env doc + opt-out rollout (Task 3 Step 6 + manual verify Step 9), no DB/dep/schema change (none introduced). All covered.
- **Type consistency:** `resolveRepoPaths(reposRoot, repos): string[]`, `buildToolArgs({enabled, repoPaths}): string[]`, `executeJob(...6 args...)`, `runClaude(...5 args...)` — used identically across tasks and call sites.
- **Placeholder scan:** none — every code step shows complete code.
