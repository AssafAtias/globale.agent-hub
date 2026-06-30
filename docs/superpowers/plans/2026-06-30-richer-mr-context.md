# Richer MR Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich GitLab MR-review `run.context` with the linked Jira ticket, CI pipeline status + failed job names, and existing MR discussion comments — all best-effort, server-side.

**Architecture:** A pure `extractIssueKey` helper + three pure GitLab response parsers (`parsePipeline`/`parseFailedJobs`/`parseDiscussions`) feed two new thin `GitLabClient` network methods; `ContextFetcher.fetch` runs three independent best-effort enrichments after `getMrContext` and `serializeForRunner` renders the new sections.

**Tech Stack:** Fastify + TypeScript (`apps/server`), Jest + ts-jest tests, GitLab REST v4 + Jira REST v3 over `fetch`.

## Global Constraints

- Enrichments are **independent best-effort**: each wrapped in its own `try/catch` with `console.warn('[ContextFetcher] …', e)`; one failure never drops the diff or the other enrichments.
- Linked ticket **reuses the existing `ctx.ticket` field** and its `Jira Ticket` serialization block (the `mr:` and `jira:` branches are mutually exclusive, so no collision).
- CI = pipeline **status + failed job names only** (no logs). GitLab jobs filter uses the repeated-param `?scope[]=failed` (NOT `scope=failed`).
- Pure parsers are unit-tested; the `fetch`-based network methods are not (consistent with the existing untested `getMrContext`). `ContextFetcher.fetch` is tested via fake injection.
- `.js` import extensions (NodeNext). Tests are Jest, no import of `describe/it/expect` (globals), matching existing `test/*.test.ts`.
- No DB migration, no new dependencies, no client/schema change.
- Spec: `docs/superpowers/specs/2026-06-30-richer-mr-context-design.md`.

---

### Task 1: `extractIssueKey` helper

**Files:**
- Create: `apps/server/src/services/issueKey.ts`
- Test: `apps/server/test/issueKey.test.ts`

**Interfaces:**
- Produces: `extractIssueKey(sourceBranch: string, title: string, description: string): string | null` — first `/\b[A-Z][A-Z0-9]+-\d+\b/` match scanning branch → title → description; else null.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/issueKey.test.ts`:

```ts
import { extractIssueKey } from '../src/services/issueKey.js';

describe('extractIssueKey', () => {
  it('extracts the key from the branch', () => {
    expect(extractIssueKey('feature/CORE-211920-some-fix', 'title', 'desc')).toBe('CORE-211920');
  });
  it('handles bug/CORE-123 style branches', () => {
    expect(extractIssueKey('bug/CORE-123', '', '')).toBe('CORE-123');
  });
  it('falls back to the title when the branch has no key', () => {
    expect(extractIssueKey('hotfix', 'Fix CORE-9 crash', '')).toBe('CORE-9');
  });
  it('falls back to the description', () => {
    expect(extractIssueKey('hotfix', 'no key', 'relates to CORE-42')).toBe('CORE-42');
  });
  it('returns null when there is no key anywhere', () => {
    expect(extractIssueKey('main', 'cleanup', 'no tickets here')).toBeNull();
  });
  it('branch wins over title', () => {
    expect(extractIssueKey('feature/CORE-1-x', 'mentions CORE-2', '')).toBe('CORE-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/issueKey.test.ts`
Expected: FAIL — cannot find module `../src/services/issueKey.js`.

- [ ] **Step 3: Implement the helper**

Create `apps/server/src/services/issueKey.ts`:

```ts
const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;

/** First Jira-style key (e.g. CORE-211920) scanning branch → title → description. */
export function extractIssueKey(sourceBranch: string, title: string, description: string): string | null {
  for (const field of [sourceBranch, title, description]) {
    const m = (field ?? '').match(KEY_RE);
    if (m) return m[0];
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/issueKey.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/issueKey.ts apps/server/test/issueKey.test.ts
git commit -m "feat(server): add extractIssueKey helper"
```

---

### Task 2: GitLab pipeline + discussions (parsers & methods)

**Files:**
- Modify: `apps/server/src/services/GitLabClient.ts`
- Test: `apps/server/test/gitlabParsers.test.ts`

**Interfaces:**
- Produces:
  - `interface MrPipeline { status: string; failedJobs: string[]; }`
  - `interface MrDiscussionNote { author: string; body: string; }`
  - `parsePipeline(pipelinesJson: unknown): { id: number; status: string } | null`
  - `parseFailedJobs(jobsJson: unknown): string[]`
  - `parseDiscussions(discussionsJson: unknown): MrDiscussionNote[]`
  - `GitLabClient.getMrPipeline(projectPath, mrIid): Promise<MrPipeline | null>`
  - `GitLabClient.getMrDiscussions(projectPath, mrIid): Promise<MrDiscussionNote[]>`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/gitlabParsers.test.ts`:

```ts
import { parsePipeline, parseFailedJobs, parseDiscussions } from '../src/services/GitLabClient.js';

describe('parsePipeline', () => {
  it('returns the first element id+status (GitLab lists newest-first)', () => {
    expect(parsePipeline([{ id: 5, status: 'failed' }, { id: 4, status: 'success' }]))
      .toEqual({ id: 5, status: 'failed' });
  });
  it('returns null for empty / non-array / missing numeric id', () => {
    expect(parsePipeline([])).toBeNull();
    expect(parsePipeline(null)).toBeNull();
    expect(parsePipeline([{ status: 'failed' }])).toBeNull();
  });
});

describe('parseFailedJobs', () => {
  it('returns names of jobs with status "failed" only', () => {
    expect(parseFailedJobs([
      { name: 'build', status: 'failed' },
      { name: 'test', status: 'success' },
      { name: 'lint', status: 'failed' },
    ])).toEqual(['build', 'lint']);
  });
  it('returns [] for non-array / empty', () => {
    expect(parseFailedJobs(null)).toEqual([]);
    expect(parseFailedJobs([])).toEqual([]);
  });
});

describe('parseDiscussions', () => {
  it('flattens notes across discussions, drops system notes, maps author/body', () => {
    const input = [
      { notes: [{ system: true, body: 'changed status', author: { name: 'Bot' } }] },
      { notes: [{ system: false, body: 'Looks good', author: { name: 'Alice' } }] },
      { notes: [{ body: 'nit', author: { username: 'bob' } }] },
    ];
    expect(parseDiscussions(input)).toEqual([
      { author: 'Alice', body: 'Looks good' },
      { author: 'bob', body: 'nit' },
    ]);
  });
  it('author falls back to "unknown"; body sliced to 1000', () => {
    const out = parseDiscussions([{ notes: [{ body: 'x'.repeat(2000) }] }]);
    expect(out[0].author).toBe('unknown');
    expect(out[0].body).toHaveLength(1000);
  });
  it('caps at 30 after flattening', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ body: `n${i}`, author: { name: 'A' } }));
    expect(parseDiscussions([{ notes }])).toHaveLength(30);
  });
  it('returns [] for non-array', () => {
    expect(parseDiscussions(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/gitlabParsers.test.ts`
Expected: FAIL — `parsePipeline`/`parseFailedJobs`/`parseDiscussions` not exported.

- [ ] **Step 3: Add interfaces + pure parsers + methods**

In `apps/server/src/services/GitLabClient.ts`, add the interfaces near the top (after the existing `MrContext` interface):

```ts
export interface MrPipeline { status: string; failedJobs: string[]; }
export interface MrDiscussionNote { author: string; body: string; }
```

Add the pure parsers (module-level, exported, outside the class):

```ts
// GitLab returns pipelines newest-first, so element 0 is the latest.
export function parsePipeline(pipelinesJson: unknown): { id: number; status: string } | null {
  if (!Array.isArray(pipelinesJson) || pipelinesJson.length === 0) return null;
  const p = pipelinesJson[0] as Record<string, unknown>;
  const id = p?.['id'];
  const status = p?.['status'];
  if (typeof id !== 'number' || typeof status !== 'string') return null;
  return { id, status };
}

export function parseFailedJobs(jobsJson: unknown): string[] {
  if (!Array.isArray(jobsJson)) return [];
  return jobsJson
    .filter((j) => (j as Record<string, unknown>)?.['status'] === 'failed')
    .map((j) => (j as Record<string, unknown>)?.['name'])
    .filter((n): n is string => typeof n === 'string');
}

export function parseDiscussions(discussionsJson: unknown): MrDiscussionNote[] {
  if (!Array.isArray(discussionsJson)) return [];
  const out: MrDiscussionNote[] = [];
  for (const d of discussionsJson) {
    const notes = (d as Record<string, unknown>)?.['notes'];
    if (!Array.isArray(notes)) continue;
    for (const n of notes) {
      const note = n as Record<string, unknown>;
      if (note?.['system']) continue;
      const body = note?.['body'];
      if (typeof body !== 'string') continue;
      const author = note?.['author'] as Record<string, unknown> | undefined;
      out.push({
        author: (author?.['name'] as string) ?? (author?.['username'] as string) ?? 'unknown',
        body: body.slice(0, 1000),
      });
    }
  }
  return out.slice(0, 30);
}
```

Add the two methods inside the `GitLabClient` class (after `getMrContext`):

```ts
  async getMrPipeline(projectPath: string, mrIid: number): Promise<MrPipeline | null> {
    const encoded = encodeURIComponent(projectPath);
    const headers = { 'PRIVATE-TOKEN': this.token };
    const res = await fetch(`${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}/pipelines`, { headers });
    if (!res.ok) throw new Error(`GitLab pipelines fetch failed: ${res.status}`);
    const p = parsePipeline(await res.json());
    if (!p) return null;
    if (p.status === 'success') return { status: 'success', failedJobs: [] };
    const jobsRes = await fetch(`${this.baseUrl}/api/v4/projects/${encoded}/pipelines/${p.id}/jobs?scope[]=failed`, { headers });
    const failedJobs = jobsRes.ok ? parseFailedJobs(await jobsRes.json()) : [];
    return { status: p.status, failedJobs };
  }

  async getMrDiscussions(projectPath: string, mrIid: number): Promise<MrDiscussionNote[]> {
    const encoded = encodeURIComponent(projectPath);
    const res = await fetch(
      `${this.baseUrl}/api/v4/projects/${encoded}/merge_requests/${mrIid}/discussions`,
      { headers: { 'PRIVATE-TOKEN': this.token } },
    );
    if (!res.ok) throw new Error(`GitLab discussions fetch failed: ${res.status}`);
    return parseDiscussions(await res.json());
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/gitlabParsers.test.ts`
Expected: PASS — all parser tests green.

- [ ] **Step 5: Typecheck**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/GitLabClient.ts apps/server/test/gitlabParsers.test.ts
git commit -m "feat(server): add GitLab pipeline + discussions fetch (parsers + methods)"
```

---

### Task 3: ContextFetcher enrichment + serialization

**Files:**
- Modify: `apps/server/src/services/ContextFetcher.ts`
- Test: `apps/server/test/ContextFetcher.test.ts` (extend)

**Interfaces:**
- Consumes: `extractIssueKey` (Task 1); `MrPipeline`, `MrDiscussionNote`, `getMrPipeline`, `getMrDiscussions` (Task 2); existing `getMrContext`, `JiraClient.getTicket`.
- Produces: enriched `FetchedContext` (`+ pipeline?`, `+ discussions?`) and the end-to-end behavior. No further tasks depend on this.

- [ ] **Step 1: Write the failing test (extend the existing file)**

Append to `apps/server/test/ContextFetcher.test.ts`:

```ts
import { extractIssueKey } from '../src/services/issueKey.js'; // ensure path resolves (unused import removed if lint complains)

describe('ContextFetcher.fetch MR enrichment', () => {
  const event = {
    platform: 'gitlab',
    eventType: 'mr:opened',
    payload: { project: { path_with_namespace: 'g/r' }, object_attributes: { iid: 7 } },
  };

  function fakeFetcher() {
    const f = new ContextFetcher('gl-token', 'jira-token', 'https://j', 'e@x');
    (f as any).gitlab = {
      getMrContext: async () => ({
        title: 'T', description: 'D', sourceBranch: 'feature/CORE-9-x',
        targetBranch: 'main', mrUrl: 'u', diff: 'DIFFTEXT',
      }),
      getMrPipeline: async () => ({ status: 'failed', failedJobs: ['build', 'test'] }),
      getMrDiscussions: async () => ([{ author: 'Alice', body: 'nit' }]),
    };
    (f as any).jira = {
      getTicket: async (k: string) => ({ key: k, summary: 'S', description: 'TD', status: 'Open', labels: [], url: 'u' }),
    };
    return f;
  }

  it('enriches with linked ticket, pipeline, and comments', async () => {
    const f = fakeFetcher();
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('DIFFTEXT');
    expect(s).toContain('CORE-9: S');
    expect(s).toContain('Failed jobs: build, test');
    expect(s).toContain('- Alice: nit');
  });

  it('is best-effort: a pipeline fetch error does not drop diff/ticket/comments', async () => {
    const f = fakeFetcher();
    (f as any).gitlab.getMrPipeline = async () => { throw new Error('boom'); };
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('DIFFTEXT');
    expect(s).toContain('CORE-9: S');
    expect(s).toContain('- Alice: nit');
    expect(s).not.toContain('Pipeline');
  });

  it('omits sections when pipeline is null and discussions empty', async () => {
    const f = fakeFetcher();
    (f as any).gitlab.getMrPipeline = async () => null;
    (f as any).gitlab.getMrDiscussions = async () => [];
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('DIFFTEXT');
    expect(s).not.toContain('Existing MR Comments');
  });
});
```

(If the `extractIssueKey` import is flagged unused by the build, delete that import line — it's only there to confirm the module resolves; the behavior is exercised through `fetch`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/ContextFetcher.test.ts`
Expected: FAIL — the new enrichment block doesn't exist yet (no `Failed jobs` / `- Alice: nit` in output).

- [ ] **Step 3: Add the imports + fields**

In `apps/server/src/services/ContextFetcher.ts`, update the GitLabClient import to also bring the new types, and add the issueKey import:

```ts
import { GitLabClient, type MrContext, type MrPipeline, type MrDiscussionNote } from './GitLabClient.js';
import { extractIssueKey } from './issueKey.js';
```

Extend `FetchedContext`:

```ts
export interface FetchedContext {
  mr?: MrContext;
  ticket?: JiraTicketContext;
  pipeline?: MrPipeline;
  discussions?: MrDiscussionNote[];
  rawPayload: Record<string, unknown>;
}
```

- [ ] **Step 4: Add the best-effort enrichment in `fetch`**

In the `mr:` branch of `fetch`, replace the existing block:

```ts
      if (project && attrs?.['iid']) {
        try {
          ctx.mr = await this.gitlab.getMrContext(project, attrs['iid'] as number);
        } catch (e) {
          console.warn('[ContextFetcher] Failed to fetch MR context:', e);
        }
      }
```

with:

```ts
      if (project && attrs?.['iid']) {
        const iid = attrs['iid'] as number;
        try {
          ctx.mr = await this.gitlab.getMrContext(project, iid);
        } catch (e) {
          console.warn('[ContextFetcher] Failed to fetch MR context:', e);
        }
        if (ctx.mr) {
          const key = extractIssueKey(ctx.mr.sourceBranch, ctx.mr.title, ctx.mr.description);
          if (key && this.jira) {
            try {
              ctx.ticket = await this.jira.getTicket(key);
            } catch (e) {
              console.warn('[ContextFetcher] Failed to fetch linked Jira ticket:', e);
            }
          }
          try {
            ctx.pipeline = (await this.gitlab.getMrPipeline(project, iid)) ?? undefined;
          } catch (e) {
            console.warn('[ContextFetcher] Failed to fetch MR pipeline:', e);
          }
          try {
            const discussions = await this.gitlab.getMrDiscussions(project, iid);
            if (discussions.length > 0) ctx.discussions = discussions;
          } catch (e) {
            console.warn('[ContextFetcher] Failed to fetch MR discussions:', e);
          }
        }
      }
```

- [ ] **Step 5: Add serialization sections**

In `serializeForRunner`, after the existing `if (ctx.ticket) { … }` block and before the empty-parts fallback (`if (Object.keys(parts).length === 0)`), add:

```ts
    if (ctx.pipeline) {
      parts['Pipeline'] = ctx.pipeline.failedJobs.length > 0
        ? `${ctx.pipeline.status}\nFailed jobs: ${ctx.pipeline.failedJobs.join(', ')}`
        : ctx.pipeline.status;
    }
    if (ctx.discussions && ctx.discussions.length > 0) {
      parts['Existing MR Comments'] = ctx.discussions.map((n) => `- ${n.author}: ${n.body}`).join('\n');
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/server && npx jest test/ContextFetcher.test.ts`
Expected: PASS — all enrichment cases green (plus the pre-existing `fetchOpenAssignedTicket` cases).

- [ ] **Step 7: Typecheck + full server suite**

Run: `cd apps/server && npx tsc --noEmit && npx jest`
Expected: tsc clean; full suite green (existing + issueKey + gitlabParsers + extended ContextFetcher).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/ContextFetcher.ts apps/server/test/ContextFetcher.test.ts
git commit -m "feat(server): enrich MR context with linked ticket, pipeline, discussions"
```

---

## Self-Review Notes

- **Spec coverage:** linked ticket via extractIssueKey→getTicket reusing ctx.ticket (Task 1 + Task 3 Step 4); CI status+failed-job-names with `scope[]=failed` (Task 2); discussions drop-system + cap-30 (Task 2); best-effort independent try/catch (Task 3 Step 4); serialization sections with status-only-when-no-failed-jobs + omit-when-empty (Task 3 Step 5); pure parsers tested, network methods not, fetch tested via fakes incl. getMrContext (Tasks 2 & 3). All covered.
- **Type consistency:** `MrPipeline`/`MrDiscussionNote`, `parsePipeline`/`parseFailedJobs`/`parseDiscussions`, `getMrPipeline`/`getMrDiscussions`, `extractIssueKey`, `FetchedContext.pipeline`/`discussions` — defined in Tasks 1-2, consumed identically in Task 3.
- **Placeholder scan:** none — every code step is complete.
