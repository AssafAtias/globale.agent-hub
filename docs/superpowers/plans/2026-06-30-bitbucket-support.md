# Bitbucket Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support the Core PR-review loop on Bitbucket Cloud — PR webhook → fetch diff → run agent → post the review back as a PR comment, with linked-Jira enrichment.

**Architecture:** A new `BitbucketClient` (Bitbucket REST 2.0) with pure helpers; a `parseBitbucketEvent` mapping `pullrequest:*` (from the `X-Event-Key` header) to the existing `mr:*` vocabulary; a `/webhooks/bitbucket` route (URL-token auth); and Bitbucket branches in `ContextFetcher` (diff + linked Jira) and `ResultDispatcher` (a payload-shape comment router). Reuses `MrContext`, `matchAgents`, `serializeForRunner`.

**Tech Stack:** Fastify + TypeBox (`apps/server`), Jest + ts-jest, Bitbucket Cloud REST 2.0 + Jira REST v3 over `fetch`.

## Global Constraints

- Reuse the existing `MrContext` type and `mr:opened`/`mr:updated`/`mr:merged` event strings (a PR is an MR). Bitbucket distinguished by the `bitbucket:` repo prefix.
- Bitbucket API auth: `bitbucketAuthHeader(token, username?)` → `Bearer <token>` by default, `Basic base64(username:<token>)` when `username` set. The ctor param is **`username`** (not `email`).
- Webhook auth: `/webhooks/bitbucket?token=<secret>` verified against `BITBUCKET_WEBHOOK_SECRET`; warn (don't hard-require) when the secret is unset (Jira-route convention). `x-event-key` header schema MUST be `Type.Optional` + `additionalProperties: true` (never 400 on a missing header).
- Diff hard-capped at `diff.slice(0, 60000)`; comment body `body.slice(0, 32000)`.
- `ResultDispatcher` `pr_comment` is a **single** branch delegating to a payload-shape router; the Bitbucket path is NOT nested under the `this.gitlab` guard.
- Bitbucket client/contextfetcher/resultdispatcher constructor args are **appended** (trailing) to preserve existing positional args.
- `.js` import extensions; Jest globals (no describe/it/expect import). No DB migration, no new dependencies, no client/schema change.
- Spec: `docs/superpowers/specs/2026-06-30-bitbucket-support-design.md`.

---

### Task 1: BitbucketClient + config

**Files:**
- Modify: `apps/server/src/config/environment.ts`
- Create: `apps/server/src/services/BitbucketClient.ts`
- Test: `apps/server/test/bitbucketClient.test.ts`

**Interfaces:**
- Produces:
  - `bitbucketAuthHeader(token: string, username?: string): string`
  - `prJsonToMrContext(pr: unknown, diff: string): MrContext` (MrContext imported from `GitLabClient.js`)
  - `class BitbucketClient` with `getPrContext(workspaceRepo, prId): Promise<MrContext>` and `postPrComment(workspaceRepo, prId, body): Promise<void>`
  - config: `BITBUCKET_API_TOKEN?`, `BITBUCKET_USERNAME?`, `BITBUCKET_WEBHOOK_SECRET?`

- [ ] **Step 1: Add config fields**

In `apps/server/src/config/environment.ts`, add to the `Environment` type (near the other optional tokens):

```ts
  BITBUCKET_API_TOKEN: string | undefined;
  BITBUCKET_USERNAME: string | undefined;
  BITBUCKET_WEBHOOK_SECRET: string | undefined;
```

And in the object returned by `loadConfig()`:

```ts
    BITBUCKET_API_TOKEN: process.env.BITBUCKET_API_TOKEN,
    BITBUCKET_USERNAME: process.env.BITBUCKET_USERNAME,
    BITBUCKET_WEBHOOK_SECRET: process.env.BITBUCKET_WEBHOOK_SECRET,
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/test/bitbucketClient.test.ts`:

```ts
import { bitbucketAuthHeader, prJsonToMrContext } from '../src/services/BitbucketClient.js';

describe('bitbucketAuthHeader', () => {
  it('returns Bearer when no username', () => {
    expect(bitbucketAuthHeader('tok')).toBe('Bearer tok');
  });
  it('returns Basic base64(username:token) when username set', () => {
    expect(bitbucketAuthHeader('tok', 'alice')).toBe(`Basic ${Buffer.from('alice:tok').toString('base64')}`);
  });
});

describe('prJsonToMrContext', () => {
  it('maps PR JSON fields plus the passed diff', () => {
    const pr = {
      title: 'T', description: 'D',
      source: { branch: { name: 'feat' } },
      destination: { branch: { name: 'main' } },
      links: { html: { href: 'https://bb/pr/1' } },
    };
    expect(prJsonToMrContext(pr, 'DIFF')).toEqual({
      title: 'T', description: 'D', sourceBranch: 'feat',
      targetBranch: 'main', mrUrl: 'https://bb/pr/1', diff: 'DIFF',
    });
  });
  it('defaults a missing description to empty string', () => {
    const pr = { title: 'T', source: { branch: { name: 'f' } }, destination: { branch: { name: 'm' } }, links: { html: { href: 'u' } } };
    expect(prJsonToMrContext(pr, '').description).toBe('');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && npx jest test/bitbucketClient.test.ts`
Expected: FAIL — module `../src/services/BitbucketClient.js` not found.

- [ ] **Step 4: Implement BitbucketClient**

Create `apps/server/src/services/BitbucketClient.ts`:

```ts
import type { MrContext } from './GitLabClient.js';

/** Bearer by default; Basic base64(username:token) when a username (app-password flow) is given. */
export function bitbucketAuthHeader(token: string, username?: string): string {
  return username
    ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
    : `Bearer ${token}`;
}

/** Map a Bitbucket Cloud PR JSON object + raw diff text into the shared MrContext shape. */
export function prJsonToMrContext(pr: unknown, diff: string): MrContext {
  const p = (pr ?? {}) as Record<string, unknown>;
  const source = (p['source'] as Record<string, unknown>)?.['branch'] as Record<string, unknown> | undefined;
  const dest = (p['destination'] as Record<string, unknown>)?.['branch'] as Record<string, unknown> | undefined;
  const html = (p['links'] as Record<string, unknown>)?.['html'] as Record<string, unknown> | undefined;
  return {
    title: (p['title'] as string) ?? '',
    description: (p['description'] as string) ?? '',
    sourceBranch: (source?.['name'] as string) ?? '',
    targetBranch: (dest?.['name'] as string) ?? '',
    mrUrl: (html?.['href'] as string) ?? '',
    diff,
  };
}

export class BitbucketClient {
  constructor(private token: string, private username?: string, private baseUrl = 'https://api.bitbucket.org') {}

  // workspaceRepo is "{workspace}/{repo_slug}" — the slash is preserved (not encoded).
  async getPrContext(workspaceRepo: string, prId: number): Promise<MrContext> {
    const headers = { Authorization: bitbucketAuthHeader(this.token, this.username) };
    const base = `${this.baseUrl}/2.0/repositories/${workspaceRepo}/pullrequests/${prId}`;
    const [prRes, diffRes] = await Promise.all([
      fetch(base, { headers }),
      fetch(`${base}/diff`, { headers }),
    ]);
    if (!prRes.ok) throw new Error(`Bitbucket PR fetch failed: ${prRes.status}`);
    const pr = await prRes.json();
    const diff = diffRes.ok ? (await diffRes.text()).slice(0, 60000) : '';
    return prJsonToMrContext(pr, diff);
  }

  async postPrComment(workspaceRepo: string, prId: number, body: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/2.0/repositories/${workspaceRepo}/pullrequests/${prId}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: bitbucketAuthHeader(this.token, this.username),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: { raw: body.slice(0, 32000) } }),
      },
    );
    if (!res.ok) throw new Error(`Bitbucket comment post failed: ${res.status}`);
  }
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/server && npx jest test/bitbucketClient.test.ts && npx tsc --noEmit`
Expected: 4 tests pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/config/environment.ts apps/server/src/services/BitbucketClient.ts apps/server/test/bitbucketClient.test.ts
git commit -m "feat(server): add BitbucketClient + config"
```

---

### Task 2: parseBitbucketEvent + /webhooks/bitbucket route

**Files:**
- Modify: `apps/server/src/services/WebhookMatcher.ts`
- Modify: `apps/server/src/api/routes/webhooks.ts`
- Test: `apps/server/test/bitbucketParse.test.ts`

**Interfaces:**
- Consumes: `ParsedWebhookEvent`, `matchAgents` (existing); `ContextFetcher` ctor (gains 2 trailing Bitbucket args in Task 3 — for this task the webhooks-route ContextFetcher construction passes `config.BITBUCKET_API_TOKEN, config.BITBUCKET_USERNAME` as args 5 & 6, which the Task-3 ctor change consumes; until then they are extra trailing args the 4-arg ctor ignores — so land Task 2's route wiring with the args and Task 3 makes the ctor use them).
- Produces: `parseBitbucketEvent(body, eventKey): ParsedWebhookEvent | null`; the `/webhooks/bitbucket` route.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/bitbucketParse.test.ts`:

```ts
import { parseBitbucketEvent } from '../src/services/WebhookMatcher.js';

const body = {
  repository: { full_name: 'globaleteam/core' },
  pullrequest: { id: 7, source: { branch: { name: 'feature/CORE-9-x' } } },
};

describe('parseBitbucketEvent', () => {
  it('maps pullrequest:created → mr:opened with repo prefix + sourceRef', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:created')).toEqual({
      platform: 'bitbucket', repo: 'bitbucket:globaleteam/core',
      eventType: 'mr:opened', sourceRef: 'feature/CORE-9-x', payload: body,
    });
  });
  it('maps pullrequest:updated → mr:updated', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:updated')?.eventType).toBe('mr:updated');
  });
  it('maps pullrequest:fulfilled → mr:merged', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:fulfilled')?.eventType).toBe('mr:merged');
  });
  it('returns null for an unmapped event key', () => {
    expect(parseBitbucketEvent(body, 'pullrequest:rejected')).toBeNull();
  });
  it('returns null when repository.full_name is missing', () => {
    expect(parseBitbucketEvent({ pullrequest: { id: 1 } }, 'pullrequest:created')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/bitbucketParse.test.ts`
Expected: FAIL — `parseBitbucketEvent` not exported.

- [ ] **Step 3: Implement the parser**

In `apps/server/src/services/WebhookMatcher.ts`, add (after `parseJiraEvent`):

```ts
export function parseBitbucketEvent(body: Record<string, unknown>, eventKey: string): ParsedWebhookEvent | null {
  const eventMap: Record<string, string> = {
    'pullrequest:created': 'mr:opened',
    'pullrequest:updated': 'mr:updated',
    'pullrequest:fulfilled': 'mr:merged',
  };
  const eventType = eventMap[eventKey];
  if (!eventType) return null;

  const fullName = (body['repository'] as Record<string, unknown>)?.['full_name'] as string;
  if (!fullName) return null;

  const pr = body['pullrequest'] as Record<string, unknown> | undefined;
  const sourceRef = ((pr?.['source'] as Record<string, unknown>)?.['branch'] as Record<string, unknown>)?.['name'] as string | undefined;

  return { platform: 'bitbucket', repo: `bitbucket:${fullName}`, eventType, sourceRef, payload: body };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/bitbucketParse.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Add the route + ContextFetcher wiring**

In `apps/server/src/api/routes/webhooks.ts`:

Update the import:
```ts
import { parseGitLabEvent, parseJiraEvent, parseBitbucketEvent, matchAgents } from '../../services/WebhookMatcher.js';
```

Update the shared `ContextFetcher` construction to pass the Bitbucket args (these become live in Task 3; harmless trailing args now):
```ts
    const fetcher = new ContextFetcher(
      config.GITLAB_API_TOKEN,
      config.JIRA_API_TOKEN,
      config.JIRA_BASE_URL,
      config.JIRA_EMAIL,
      config.BITBUCKET_API_TOKEN,
      config.BITBUCKET_USERNAME,
    );
```

Add a warning next to the existing Jira one:
```ts
    if (!config.BITBUCKET_WEBHOOK_SECRET) {
      app.log.warn('[webhooks] BITBUCKET_WEBHOOK_SECRET is not set — /webhooks/bitbucket is unauthenticated');
    }
```

Add the route (after the `/webhooks/jira` handler):
```ts
    app.post('/webhooks/bitbucket', {
      schema: {
        querystring: Type.Object({ token: Type.Optional(Type.String()) }, { additionalProperties: true }),
        headers: Type.Object({ 'x-event-key': Type.Optional(Type.String()) }, { additionalProperties: true }),
        body: Type.Any(),
      },
    }, async (req, reply) => {
      const secret = config.BITBUCKET_WEBHOOK_SECRET;
      if (secret && (req.query as Record<string, unknown>)['token'] !== secret) {
        return reply.status(401).send({ error: 'Invalid webhook token' });
      }

      const eventKey = (req.headers['x-event-key'] as string | undefined) ?? '';
      const event = parseBitbucketEvent(req.body as Record<string, unknown>, eventKey);
      if (!event) return reply.status(200).send({ skipped: true });

      const matched = matchAgents(event);
      if (matched.length === 0) return reply.status(200).send({ skipped: true, reason: 'no agents match' });

      const context = await fetcher.fetch(event);
      const contextStr = fetcher.serializeForRunner(context);

      const createdRuns = matched.map(agent =>
        RunRepository.create({
          agentId: agent.id,
          trigger: 'webhook',
          triggerPayload: JSON.stringify(req.body),
          context: contextStr,
        })
      );
      app.log.info({ runIds: createdRuns.map(r => r.id) }, 'Created runs from Bitbucket webhook');
      return reply.status(200).send({ created: createdRuns.length });
    });
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no errors. (The 6-arg `ContextFetcher` call compiles because TS allows extra args only if the signature declares them — so this step REQUIRES Task 3's ctor change to already be present OR will error. If it errors here, that's expected; land Step 6's typecheck after Task 3. To keep Task 2 self-contained, temporarily the ctor in `ContextFetcher` may need its 2 optional params added now — see note.)

> **Sequencing note:** the 2 extra args on the `ContextFetcher` call require the ctor to accept them. To keep each task green independently, **add the two optional ctor params (`bitbucketToken?`, `bitbucketUsername?`) to `ContextFetcher` as part of THIS task** (Step 5b below), even though the `fetch` branch that uses them lands in Task 3.

- [ ] **Step 5b: Add the optional ctor params to ContextFetcher (so Task 2 compiles)**

In `apps/server/src/services/ContextFetcher.ts`, extend the constructor signature only (no body use yet):
```ts
  constructor(gitlabToken?: string, jiraToken?: string, jiraBaseUrl?: string, jiraEmail?: string, bitbucketToken?: string, bitbucketUsername?: string) {
    if (gitlabToken) this.gitlab = new GitLabClient(gitlabToken);
    if (jiraToken && jiraBaseUrl) this.jira = new JiraClient(jiraToken, jiraBaseUrl, jiraEmail);
    if (bitbucketToken) this.bitbucket = new BitbucketClient(bitbucketToken, bitbucketUsername);
  }
```
Add the field + import:
```ts
import { BitbucketClient } from './BitbucketClient.js';
// in the class:
  private bitbucket?: BitbucketClient;
```
(The `fetch` branch using `this.bitbucket` is Task 3.)

- [ ] **Step 7: Run full suite + typecheck**

Run: `cd apps/server && npx tsc --noEmit && npx jest`
Expected: tsc clean; all tests pass (existing + bitbucketClient + bitbucketParse).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/WebhookMatcher.ts apps/server/src/api/routes/webhooks.ts apps/server/src/services/ContextFetcher.ts apps/server/test/bitbucketParse.test.ts
git commit -m "feat(server): add parseBitbucketEvent + /webhooks/bitbucket route"
```

---

### Task 3: ContextFetcher branch + ResultDispatcher routing + wiring

**Files:**
- Modify: `apps/server/src/services/ContextFetcher.ts`
- Modify: `apps/server/src/services/ResultDispatcher.ts`
- Modify: `apps/server/src/api/routes/runs.ts`
- Test: `apps/server/test/ContextFetcher.test.ts` (extend), `apps/server/test/resultDispatcherBitbucket.test.ts` (new)

**Interfaces:**
- Consumes: `BitbucketClient`, `prJsonToMrContext`-shaped `MrContext`, `extractIssueKey`, the `ContextFetcher` ctor params from Task 2 Step 5b.
- Produces: the Bitbucket `fetch` branch; the `ResultDispatcher` shape-router; end-to-end behavior. No further tasks depend on this.

- [ ] **Step 1: Write the failing ContextFetcher test (extend)**

Append to `apps/server/test/ContextFetcher.test.ts`:

```ts
describe('ContextFetcher.fetch Bitbucket', () => {
  const event = {
    platform: 'bitbucket',
    eventType: 'mr:opened',
    payload: { repository: { full_name: 'globaleteam/core' }, pullrequest: { id: 7 } },
  };
  function fakeFetcher() {
    const f = new ContextFetcher(undefined, 'jt', 'https://j', 'e@x', 'bbtok');
    (f as any).bitbucket = {
      getPrContext: async () => ({
        title: 'T', description: 'D', sourceBranch: 'feature/CORE-9-x',
        targetBranch: 'main', mrUrl: 'u', diff: 'BBDIFF',
      }),
    };
    (f as any).jira = { getTicket: async (k: string) => ({ key: k, summary: 'S', description: 'TD', status: 'Open', labels: [], url: 'u' }) };
    return f;
  }
  it('fetches the PR diff and the linked Jira ticket', async () => {
    const f = fakeFetcher();
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('BBDIFF');
    expect(s).toContain('CORE-9: S');
  });
  it('is best-effort: a getPrContext throw does not crash fetch', async () => {
    const f = fakeFetcher();
    (f as any).bitbucket.getPrContext = async () => { throw new Error('boom'); };
    const ctx = await f.fetch(event as any);
    expect(ctx.mr).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing ResultDispatcher test (new)**

Create `apps/server/test/resultDispatcherBitbucket.test.ts`:

```ts
import { ResultDispatcher } from '../src/services/ResultDispatcher.js';

function run(result: string, payload: object) {
  return { id: 'r1', result, triggerPayload: JSON.stringify(payload), replyTo: null } as any;
}
const agent = { id: 'a1', name: 'Rev', outputs: JSON.stringify(['pr_comment']), teamsTarget: null } as any;

describe('ResultDispatcher pr_comment routing', () => {
  it('routes a Bitbucket-shaped payload to the bitbucket client', async () => {
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, undefined, undefined, 'bbtok');
    const calls: any[] = [];
    (d as any).bitbucket = { postPrComment: async (repo: string, id: number, body: string) => { calls.push({ repo, id, body }); } };
    await d.dispatch(run('REVIEW', { repository: { full_name: 'globaleteam/core' }, pullrequest: { id: 7 } }), agent);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ repo: 'globaleteam/core', id: 7 });
    expect(calls[0].body).toContain('REVIEW');
  });
  it('does NOT call the bitbucket client for a GitLab-shaped payload', async () => {
    const d = new ResultDispatcher('gltok', undefined, undefined, undefined, undefined, undefined, 'bbtok');
    const bb: number[] = [];
    (d as any).bitbucket = { postPrComment: async () => { bb.push(1); } };
    (d as any).gitlab = { postMrComment: async () => {} };
    await d.dispatch(run('R', { object_attributes: { iid: 3 }, project: { path_with_namespace: 'g/r' } }), agent);
    expect(bb).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd apps/server && npx jest test/ContextFetcher.test.ts test/resultDispatcherBitbucket.test.ts`
Expected: FAIL — no Bitbucket branch in fetch; `ResultDispatcher` ctor has no 7th arg / no bitbucket routing.

- [ ] **Step 4: Add the ContextFetcher Bitbucket branch**

In `apps/server/src/services/ContextFetcher.ts`, add the `extractIssueKey` import if not already present (`import { extractIssueKey } from './issueKey.js';`), and in `fetch` (after the jira branch, before `return ctx`):

```ts
    if (event.platform === 'bitbucket' && this.bitbucket) {
      const repo = (event.payload['repository'] as Record<string, unknown>)?.['full_name'] as string | undefined;
      const prId = (event.payload['pullrequest'] as Record<string, unknown>)?.['id'] as number | undefined;
      if (repo && prId != null) {
        try {
          ctx.mr = await this.bitbucket.getPrContext(repo, prId);
        } catch (e) {
          console.warn('[ContextFetcher] Failed to fetch Bitbucket PR context:', e);
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
        }
      }
    }
```

- [ ] **Step 5: Add the ResultDispatcher Bitbucket routing**

In `apps/server/src/services/ResultDispatcher.ts`:

Add the import + field + ctor arg:
```ts
import { BitbucketClient } from './BitbucketClient.js';
// field:
  private bitbucket?: BitbucketClient;
// constructor — append 2 params after teamsWebhook:
  constructor(gitlabToken?: string, jiraToken?: string, jiraBaseUrl?: string, jiraEmail?: string, teamsNotifier?: TeamsNotifierLike, teamsWebhook?: TeamsWebhookLike, bitbucketToken?: string, bitbucketUsername?: string) {
    if (gitlabToken) this.gitlab = new GitLabClient(gitlabToken);
    if (jiraToken && jiraBaseUrl) this.jira = new JiraClient(jiraToken, jiraBaseUrl, jiraEmail);
    this.teams = teamsNotifier;
    this.teamsWebhook = teamsWebhook;
    if (bitbucketToken) this.bitbucket = new BitbucketClient(bitbucketToken, bitbucketUsername);
  }
```

Replace the existing `pr_comment` branch in `dispatch`:
```ts
      if (output === 'pr_comment' && this.gitlab) {
        await this.postGitLabComment(run.result, payload).catch(e =>
          console.error('[ResultDispatcher] pr_comment failed:', e)
        );
      }
```
with:
```ts
      if (output === 'pr_comment') {
        await this.postPrComment(run.result, payload).catch(e =>
          console.error('[ResultDispatcher] pr_comment failed:', e)
        );
      }
```

Add the router + Bitbucket poster (next to `postGitLabComment`):
```ts
  private async postPrComment(result: string, payload: Record<string, unknown>): Promise<void> {
    const isGitLab = (payload?.['object_attributes'] as Record<string, unknown>)?.['iid'] != null;
    if (isGitLab && this.gitlab) { await this.postGitLabComment(result, payload); return; }
    if (payload?.['pullrequest'] && this.bitbucket) { await this.postBitbucketComment(result, payload); return; }
    console.warn('[ResultDispatcher] pr_comment: no matching platform client for payload shape');
  }

  private async postBitbucketComment(result: string, payload: Record<string, unknown>): Promise<void> {
    const repo = (payload?.['repository'] as Record<string, unknown>)?.['full_name'] as string;
    const prId = (payload?.['pullrequest'] as Record<string, unknown>)?.['id'] as number;
    if (!repo || prId == null || !this.bitbucket) return;
    await this.bitbucket.postPrComment(repo, prId, `### Agent Hub Review\n\n${result}`);
  }
```
(`postGitLabComment` keeps its existing body.)

- [ ] **Step 6: Thread Bitbucket config in runs.ts**

In `apps/server/src/api/routes/runs.ts`:

Line ~81 (`ContextFetcher`) — append the two args:
```ts
        const fetcher = new ContextFetcher(config.GITLAB_API_TOKEN, config.JIRA_API_TOKEN, config.JIRA_BASE_URL, config.JIRA_EMAIL, config.BITBUCKET_API_TOKEN, config.BITBUCKET_USERNAME);
```
(Note: the manual `ticket-to-code` fetcher never uses Bitbucket; the args are inert here but kept for construction-site uniformity.)

Line ~142 (`ResultDispatcher`) — append the two args after `teamsWebhook`:
```ts
          const dispatcher = new ResultDispatcher(
            config.GITLAB_API_TOKEN,
            config.JIRA_API_TOKEN,
            config.JIRA_BASE_URL,
            config.JIRA_EMAIL,
            teamsNotifier,
            teamsWebhook,
            config.BITBUCKET_API_TOKEN,
            config.BITBUCKET_USERNAME,
          );
```

- [ ] **Step 7: Run both tests + full suite + typecheck**

Run: `cd apps/server && npx jest test/ContextFetcher.test.ts test/resultDispatcherBitbucket.test.ts && npx tsc --noEmit && npx jest`
Expected: the two targeted files pass; tsc clean; full suite green.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/ContextFetcher.ts apps/server/src/services/ResultDispatcher.ts apps/server/src/api/routes/runs.ts apps/server/test/ContextFetcher.test.ts apps/server/test/resultDispatcherBitbucket.test.ts
git commit -m "feat(server): Bitbucket context fetch + pr_comment routing + wiring"
```

- [ ] **Step 9: Document the env vars (if .env.example exists)**

If `apps/server/.env.example` or the repo-root `.env.example` exists, append:
```
# Bitbucket Cloud PR review (Core). Token = repo/workspace access token (Bearer) or app password (set BITBUCKET_USERNAME for Basic).
# BITBUCKET_API_TOKEN=
# BITBUCKET_USERNAME=
# BITBUCKET_WEBHOOK_SECRET=
```
If neither file exists, skip (do not create). Commit if changed:
```bash
git add -A && git commit -m "docs: document Bitbucket env vars in .env.example" || true
```

---

## Self-Review Notes

- **Spec coverage:** BitbucketClient getPrContext/postPrComment + auth header + MrContext mapping + config (Task 1); parseBitbucketEvent X-Event-Key mapping + repo prefix + sourceRef + /webhooks/bitbucket URL-token auth + Optional x-event-key schema (Task 2); ContextFetcher bitbucket branch + linked Jira best-effort + ResultDispatcher single-branch shape-router (GitLab+Bitbucket independent) + runs.ts wiring (Task 3). Diff cap 60000, comment cap 32000, trailing ctor args, reuse mr:*/MrContext — all in the code. All covered.
- **Type consistency:** `MrContext` reused; `bitbucketAuthHeader`/`prJsonToMrContext`/`BitbucketClient.getPrContext`/`postPrComment` signatures consistent across Tasks 1→3; `ContextFetcher` ctor (4→6 args) added in Task 2 Step 5b and used in Task 3; `ResultDispatcher` ctor (6→8 args) in Task 3; `parseBitbucketEvent(body, eventKey)` consistent.
- **Sequencing:** Task 2 adds the `ContextFetcher` ctor params (Step 5b) so its route wiring compiles; Task 3 adds the `fetch` body that uses them. `ResultDispatcher` 7th arg is introduced and consumed within Task 3. No task leaves the tree red.
- **Placeholder scan:** none — all code complete.
