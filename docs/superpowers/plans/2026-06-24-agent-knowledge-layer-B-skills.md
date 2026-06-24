# Agent Knowledge Layer — Plan B: Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent's Skills selector list the real skills from `C:\GlobalE\.claude\skills` and inject each selected skill's `SKILL.md` body into the agent's prompt at run time.

**Architecture:** The server scans `SKILLS_DIR` and serves a catalog (`GET /api/skills`). The client's `SkillsSelector` becomes a searchable multi-select populated from that catalog (agent still stores skill name slugs). The runner loads each selected skill's `SKILL.md` body from `SKILLS_DIR` and prepends a `## Skills` section to the system prompt.

**Tech Stack:** Fastify 5 + TypeBox + Drizzle (server, jest); React 18 + MUI 7 + TanStack Query (client, vitest); Node + `@anthropic-ai/sdk` (runner).

## Global Constraints

- `SKILLS_DIR` env var, default `C:\GlobalE\.claude\skills`, read by server and runner.
- A skill = a folder under `SKILLS_DIR` containing `SKILL.md` with frontmatter `name` + `description`. Only `SKILL.md` is used (no reference sub-files).
- The agent stores selected skill **names** (slugs) as a JSON `string[]` — unchanged on the wire.
- Skill content never enters the DB or the HTTP job payload — the runner reads it from disk.
- Per-skill body cap `MAX_SKILL_CHARS = 6000`; combined cap `MAX_SKILLS_TOTAL_CHARS = 24000`.
- No new npm dependencies (parse frontmatter with a small regex helper, not a YAML lib).
- Follow existing patterns: TypeBox schemas on routes, `Type.Any()` where the repo uses it, react-query hooks, factory-style route builders registered in `app.ts`.

---

### Task B1: Server — skill catalog service and `GET /api/skills`

**Files:**
- Modify: `apps/server/src/config/environment.ts` (add `SKILLS_DIR`)
- Create: `apps/server/src/services/SkillCatalog.ts`
- Create: `apps/server/src/api/routes/skills.ts`
- Modify: `apps/server/src/app.ts` (register the route)
- Create: `apps/server/test/skills.test.ts`

**Interfaces:**
- Produces: `parseFrontmatter(md: string): { name?: string; description?: string }`
- Produces: `class SkillCatalog { constructor(skillsDir: string); list(): { name: string; description: string }[] }` — sorted by name, skips folders with no `SKILL.md` or no `name`, returns `[]` if `skillsDir` is missing.
- Produces: `GET /api/skills` → `200` `{ name: string, description: string }[]`.
- Produces: `Environment.SKILLS_DIR: string`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/skills.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillCatalog, parseFrontmatter } from '../src/services/SkillCatalog.js';

function makeSkillsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  const write = (name: string, md: string) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), md);
  };
  write('pr-review', '---\nname: pr-review\ndescription: Review PRs thoroughly\n---\n# body');
  write('testing', '---\nname: testing\ndescription: Write tests first\n---\n# body');
  // folder with no SKILL.md → skipped
  mkdirSync(join(dir, 'empty-folder'), { recursive: true });
  // SKILL.md with no name → skipped
  write('no-name', '---\ndescription: missing name\n---\n# body');
  return dir;
}

describe('parseFrontmatter', () => {
  it('extracts name and description', () => {
    const fm = parseFrontmatter('---\nname: foo\ndescription: bar baz\n---\nbody');
    expect(fm).toEqual({ name: 'foo', description: 'bar baz' });
  });
  it('returns empty object when no frontmatter', () => {
    expect(parseFrontmatter('# just a heading')).toEqual({});
  });
});

describe('SkillCatalog', () => {
  it('lists skills sorted by name, skipping invalid folders', () => {
    const dir = makeSkillsDir();
    try {
      const list = new SkillCatalog(dir).list();
      expect(list).toEqual([
        { name: 'pr-review', description: 'Review PRs thoroughly' },
        { name: 'testing', description: 'Write tests first' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns empty array when skillsDir does not exist', () => {
    expect(new SkillCatalog(join(tmpdir(), 'does-not-exist-xyz')).list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && npx jest skills.test`
Expected: FAIL — `Cannot find module '../src/services/SkillCatalog.js'`.

- [ ] **Step 3: Create the SkillCatalog service**

Create `apps/server/src/services/SkillCatalog.ts`:

```ts
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface SkillSummary {
  name: string;
  description: string;
}

/** Parse the leading YAML-ish frontmatter block for `name` and `description`. */
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const block = m[1];
  const name = block.match(/^name:\s*(.+?)\s*$/m)?.[1];
  const description = block.match(/^description:\s*(.+?)\s*$/m)?.[1];
  return { ...(name ? { name } : {}), ...(description ? { description } : {}) };
}

export class SkillCatalog {
  constructor(private skillsDir: string) {}

  list(): SkillSummary[] {
    if (!existsSync(this.skillsDir)) return [];
    const out: SkillSummary[] = [];
    for (const entry of readdirSync(this.skillsDir)) {
      const skillMd = join(this.skillsDir, entry, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      try {
        const fm = parseFrontmatter(readFileSync(skillMd, 'utf-8'));
        if (!fm.name) continue;
        out.push({ name: fm.name, description: fm.description ?? '' });
      } catch {
        // skip unreadable skill
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && npx jest skills.test`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Add `SKILLS_DIR` to the environment**

In `apps/server/src/config/environment.ts`, add to the `Environment` type and `loadConfig`:

In the `Environment` type (after `JIRA_BASE_URL`):
```ts
  SKILLS_DIR: string;
```
In `loadConfig`'s `config` object (after the `JIRA_BASE_URL` line):
```ts
    SKILLS_DIR: process.env.SKILLS_DIR ?? 'C:\\GlobalE\\.claude\\skills',
```

- [ ] **Step 6: Create and register the route**

Create `apps/server/src/api/routes/skills.ts`:

```ts
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SkillCatalog } from '../../services/SkillCatalog.js';

export function buildSkillsRoutes(skillsDir: string): FastifyPluginAsyncTypebox {
  const catalog = new SkillCatalog(skillsDir);
  return async (app) => {
    app.get('/api/skills', {
      schema: {
        response: {
          200: Type.Array(Type.Object({ name: Type.String(), description: Type.String() })),
        },
      },
    }, async () => catalog.list());
  };
}
```

In `apps/server/src/app.ts`, add the import and registration:
```ts
import { buildSkillsRoutes } from './api/routes/skills.js';
```
and after `app.register(buildWebhooksRoutes(config));`:
```ts
  app.register(buildSkillsRoutes(config.SKILLS_DIR));
```

- [ ] **Step 7: Run the full server suite**

Run: `cd apps/server && npx jest`
Expected: PASS — all suites pass, including the new `skills.test`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/config/environment.ts apps/server/src/services/SkillCatalog.ts apps/server/src/api/routes/skills.ts apps/server/src/app.ts apps/server/test/skills.test.ts
git commit -m "feat(server): skill catalog service and GET /api/skills"
```

---

### Task B2: Client — searchable skill picker from the catalog

**Files:**
- Modify: `apps/client/src/api/client.ts` (add `api.skills.list`)
- Create: `apps/client/src/hooks/useSkills.ts`
- Modify: `apps/client/src/components/SkillsSelector.tsx` (searchable picker w/ descriptions)
- Modify: `apps/client/src/constants/skills.ts` (remove hardcoded `SKILL_CATALOG`)

**Interfaces:**
- Consumes: `GET /api/skills` (Task B1) → `{ name: string; description: string }[]`.
- Produces: `api.skills.list(): Promise<SkillSummary[]>` where `SkillSummary = { name: string; description: string }`.
- Produces: `useSkills()` react-query hook (`queryKey: ['skills']`).
- `SkillsSelector` props unchanged: `{ value: string[]; onChange: (skills: string[]) => void }`.

- [ ] **Step 1: Add the API method and type**

In `apps/client/src/api/client.ts`, add an exported interface near the other interfaces:
```ts
export interface SkillSummary { name: string; description: string; }
```
And add to the `api` object (after the `runners` block):
```ts
  skills: {
    list: () => req<SkillSummary[]>('/api/skills'),
  },
```

- [ ] **Step 2: Create the hook**

Create `apps/client/src/hooks/useSkills.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

export function useSkills() {
  return useQuery({ queryKey: ['skills'], queryFn: api.skills.list, staleTime: 5 * 60 * 1000 });
}
```

- [ ] **Step 3: Rewrite SkillsSelector as a searchable catalog picker**

Replace the entire contents of `apps/client/src/components/SkillsSelector.tsx`:

```tsx
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useSkills } from '../hooks/useSkills.js';
import { dedupeSkills } from '../constants/skills.js';
import type { SkillSummary } from '../api/client.js';

interface Props { value: string[]; onChange: (skills: string[]) => void; }

export function SkillsSelector({ value, onChange }: Props) {
  const { data: catalog, isLoading } = useSkills();
  const options: SkillSummary[] = catalog ?? [];

  return (
    <Autocomplete
      multiple
      options={options}
      loading={isLoading}
      // value is a string[] of skill names; map to/from catalog objects
      value={value}
      isOptionEqualToValue={(option, val) =>
        (typeof option === 'string' ? option : option.name) === (typeof val === 'string' ? val : (val as SkillSummary).name)
      }
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
      filterOptions={(opts, state) => {
        const q = state.inputValue.toLowerCase();
        if (!q) return opts;
        return opts.filter((o) => {
          const s = o as SkillSummary;
          return s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q);
        });
      }}
      onChange={(_, next) =>
        onChange(dedupeSkills(next.map((n) => (typeof n === 'string' ? n : n.name))))
      }
      renderOption={(props, option) => {
        const s = option as SkillSummary;
        return (
          <Box component="li" {...props} key={s.name}>
            <Box>
              <Typography variant="body2">{s.name}</Typography>
              {s.description && (
                <Typography variant="caption" color="text.secondary">{s.description}</Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label="Skills" placeholder="Search skills" />
      )}
    />
  );
}
```

Note: `value` is `string[]` (names) while `options` are `SkillSummary` objects — `isOptionEqualToValue` and `getOptionLabel` are written to handle both shapes so chips render the stored names even before the catalog loads.

- [ ] **Step 4: Remove the hardcoded catalog**

In `apps/client/src/constants/skills.ts`, delete the `SKILL_CATALOG` export (the array). Keep `normalizeSkill` and `dedupeSkills` exactly as they are. The file becomes:

```ts
export function normalizeSkill(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function dedupeSkills(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = normalizeSkill(raw);
    if (!s) continue;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}
```

- [ ] **Step 5: Verify build and existing tests**

Run: `cd apps/client && npx tsc --noEmit && npx vitest run`
Expected: no type errors (confirm nothing else imported `SKILL_CATALOG`; if something does, it's only `SkillsSelector`, now rewritten); all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/api/client.ts apps/client/src/hooks/useSkills.ts apps/client/src/components/SkillsSelector.tsx apps/client/src/constants/skills.ts
git commit -m "feat(client): searchable skill picker backed by GET /api/skills"
```

---

### Task B3: Runner — load skill bodies and inject into the prompt

**Files:**
- Modify: `packages/runner/src/config.ts` (add `skillsDir`)
- Modify: `packages/runner/src/poller.ts` (pass `skillsDir` to `executeJob`)
- Create: `packages/runner/src/context/SkillLoader.ts`
- Modify: `packages/runner/src/executor.ts` (extend `Job`, inject skills)
- Create: `packages/runner/test/SkillLoader.test.ts`
- Modify: `packages/runner/package.json` if no test script/jest config exists (see Step 1)

**Interfaces:**
- Consumes: `SKILLS_DIR` (same default as server).
- Produces: `class SkillLoader { constructor(skillsDir: string); load(skillNames: string[]): string }` — concatenates each skill's `SKILL.md` body (frontmatter stripped) under a `### <name>` heading, capping each body to 6000 chars and the total to 24000 chars; skips missing/unreadable skills with a `console.warn`; resolves a skill by folder name, falling back to a scan matching frontmatter `name`.
- Produces: `Job.agent.skills?: string` (JSON array of names).
- Produces: `executeJob(job, apiKey, localReposRoot, skillsDir)` — new 4th param.

- [ ] **Step 1: Ensure the runner has a test runner**

Check `packages/runner/package.json` for a `test` script and a dev dependency on `jest` + `ts-jest` (or `vitest`). If absent, add vitest (it needs no ts config and matches the client):
- Add to `devDependencies`: `"vitest": "^2.1.9"`.
- Add to `scripts`: `"test": "vitest run"`.
- Run `cd packages/runner && npm install` from the repo (workspaces) if needed.
If a runner already exists, use whatever is configured and adjust the run commands below accordingly.

- [ ] **Step 2: Write the failing SkillLoader test**

Create `packages/runner/test/SkillLoader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillLoader } from '../src/context/SkillLoader.js';

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skl-'));
  const write = (folder: string, md: string) => {
    mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, folder, 'SKILL.md'), md);
  };
  write('pr-review', '---\nname: pr-review\ndescription: d\n---\nREVIEW BODY');
  write('testing', '---\nname: testing\ndescription: d\n---\nTEST BODY');
  return dir;
}

describe('SkillLoader', () => {
  it('loads bodies with frontmatter stripped, under per-skill headings', () => {
    const dir = makeDir();
    try {
      const out = new SkillLoader(dir).load(['pr-review', 'testing']);
      expect(out).toContain('### pr-review');
      expect(out).toContain('REVIEW BODY');
      expect(out).toContain('### testing');
      expect(out).toContain('TEST BODY');
      expect(out).not.toContain('---'); // frontmatter stripped
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips missing skills and returns empty string for none found', () => {
    const dir = makeDir();
    try {
      expect(new SkillLoader(dir).load(['does-not-exist'])).toBe('');
      const out = new SkillLoader(dir).load(['pr-review', 'does-not-exist']);
      expect(out).toContain('REVIEW BODY');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caps each body to MAX_SKILL_CHARS (6000)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skl-'));
    try {
      mkdirSync(join(dir, 'big'), { recursive: true });
      writeFileSync(join(dir, 'big', 'SKILL.md'), '---\nname: big\n---\n' + 'x'.repeat(9000));
      const out = new SkillLoader(dir).load(['big']);
      const bodyLen = out.split('\n').filter((l) => l.startsWith('x')).join('').length;
      expect(bodyLen).toBeLessThanOrEqual(6000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty string for an empty skill list', () => {
    const dir = makeDir();
    try {
      expect(new SkillLoader(dir).load([])).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/runner && npx vitest run SkillLoader`
Expected: FAIL — `Cannot find module '../src/context/SkillLoader.js'`.

- [ ] **Step 4: Implement SkillLoader**

Create `packages/runner/src/context/SkillLoader.ts`:

```ts
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_SKILL_CHARS = 6000;
const MAX_SKILLS_TOTAL_CHARS = 24000;

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? md.slice(m[0].length) : md;
}

export class SkillLoader {
  constructor(private skillsDir: string) {}

  /** Resolve a skill's SKILL.md path by folder name, falling back to a scan
   *  for a SKILL.md whose frontmatter `name:` matches. Returns null if absent. */
  private resolve(name: string): string | null {
    const direct = join(this.skillsDir, name, 'SKILL.md');
    if (existsSync(direct)) return direct;
    if (!existsSync(this.skillsDir)) return null;
    for (const entry of readdirSync(this.skillsDir)) {
      const p = join(this.skillsDir, entry, 'SKILL.md');
      if (!existsSync(p)) continue;
      try {
        const fmName = readFileSync(p, 'utf-8').match(/^name:\s*(.+?)\s*$/m)?.[1];
        if (fmName === name) return p;
      } catch { /* skip */ }
    }
    return null;
  }

  load(skillNames: string[]): string {
    const sections: string[] = [];
    let total = 0;
    for (const name of skillNames) {
      const path = this.resolve(name);
      if (!path) {
        console.warn(`[runner] skill not found, skipping: ${name}`);
        continue;
      }
      try {
        const body = stripFrontmatter(readFileSync(path, 'utf-8')).trim().slice(0, MAX_SKILL_CHARS);
        const section = `### ${name}\n\n${body}`;
        if (total + section.length > MAX_SKILLS_TOTAL_CHARS) break;
        sections.push(section);
        total += section.length;
      } catch {
        console.warn(`[runner] skill unreadable, skipping: ${name}`);
      }
    }
    return sections.join('\n\n');
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/runner && npx vitest run SkillLoader`
Expected: PASS — all SkillLoader tests pass.

- [ ] **Step 6: Add `skillsDir` to runner config**

In `packages/runner/src/config.ts`, add `skillsDir: string;` to `RunnerConfig` and to the returned object in `loadConfig`:
```ts
    skillsDir: process.env.SKILLS_DIR ?? 'C:/GlobalE/.claude/skills',
```

- [ ] **Step 7: Extend the Job type and inject skills in the executor**

In `packages/runner/src/executor.ts`:

Add the import at the top:
```ts
import { SkillLoader } from './context/SkillLoader.js';
```

Extend the `Job` interface's `agent` to include `skills`:
```ts
  agent: {
    name: string;
    model: string;
    prompt: string;
    repos: string;
    skills?: string;
  };
```

Change `executeJob` to accept `skillsDir` and prepend a skills section to the system prompt:
```ts
export async function executeJob(job: Job, apiKey: string, localReposRoot: string, skillsDir: string): Promise<string> {
  const enricher = new LocalEnricher(localReposRoot);
  const agentRepos = (() => { try { return JSON.parse(job.agent.repos || '[]') as string[]; } catch { return [] as string[]; } })();
  const enrichedContextStr = enricher.enrich(job.run.context, agentRepos);
  const contextText = formatContext(safeParseContext(enrichedContextStr));

  const skillNames = (() => { try { return JSON.parse(job.agent.skills || '[]') as string[]; } catch { return [] as string[]; } })();
  const skillsText = new SkillLoader(skillsDir).load(skillNames);
  const systemPrompt = skillsText
    ? `## Skills\n\n${skillsText}\n\n---\n\n${job.agent.prompt}`
    : job.agent.prompt;

  return runClaude(apiKey, job.agent.model, systemPrompt, contextText);
}
```

- [ ] **Step 8: Pass `skillsDir` from the poller**

In `packages/runner/src/poller.ts`, update the `executeJob` call:
```ts
        const result = await executeJob(job, config.anthropicApiKey, config.localReposRoot, config.skillsDir);
```

- [ ] **Step 9: Build the runner to verify types**

Run: `cd packages/runner && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/runner/src/config.ts packages/runner/src/poller.ts packages/runner/src/context/SkillLoader.ts packages/runner/src/executor.ts packages/runner/test/SkillLoader.test.ts packages/runner/package.json
git commit -m "feat(runner): load and inject selected skill bodies into the prompt"
```

---

## Self-Review Notes

- **Spec coverage (B):** `GET /api/skills` + catalog → B1; searchable client picker + remove hardcoded catalog → B2; `SkillLoader` + prompt injection + Job extension + `SKILLS_DIR` config → B3. All B requirements covered.
- **Type consistency:** `SkillSummary { name, description }` identical in server route, client api, and selector. `SkillLoader.load(string[]): string` consistent between B3 definition and executor use. `executeJob` 4-arg signature updated in both executor (def) and poller (call).
- **No new deps** except vitest for the runner test harness (only if the runner has none) — consistent with the client's vitest.
- **Disk reads:** server `SkillCatalog` and runner `SkillLoader` both tolerate a missing `SKILLS_DIR` (return `[]` / `''`).
