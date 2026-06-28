# Teams Bot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the agent-hub to Microsoft Teams as a two-way bot — agents report run results into Teams, and the user converses with agents by `@mention` + slug.

**Architecture:** All new code is server-side (`apps/server`). A new `POST /api/messages` route hands inbound Teams activities to the official `botbuilder` `CloudAdapter`, which validates the request; a thin `TeamsBot` parses the message, checks an allowlist, stores the originating conversation reference on the run, and creates a run via the existing `RunRepository`. On run completion, `ResultDispatcher` gains a `teams` output that posts the result back via a shared `TeamsNotifier` (proactive messaging) — to the run's `replyTo` (conversation) or the agent's configured `teamsTarget` (channel). The runner, executor, and existing GitLab/Jira paths are unchanged.

**Tech Stack:** Node + TypeScript, Fastify 5, Drizzle ORM + better-sqlite3, TypeBox, Jest (ts-jest), `botbuilder` 4.x, React 18 + MUI (client).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-teams-bot-integration-design.md` — the authoritative design.
- **Feature gate:** the entire feature is OFF unless `MICROSOFT_APP_ID` is set. When off, the route and notifier are never registered. No behavior leaks.
- **No functionality regressions:** the existing GitLab/Jira webhook → run → dispatch flow and all existing tests must stay green.
- **No runtime migrator:** schema migrations are applied **by hand** to `apps/server/agent-hub.db` (stop the server first for the write lock). Per repo memory, the server runs from `dist/` — after server code changes you must `npx tsc` in `apps/server` and restart `node dist/index.js`.
- **Drizzle `.select()` emits an explicit column list:** any column added to `schema.ts` is referenced by EVERY query, so every in-memory test table that mirrors that schema must gain the column or unrelated tests break with `no such column`.
- **Outputs validation already permits any string** (`agents.ts` uses `Type.Array(Type.String())`), so `'teams'` needs no server-side schema change to be a valid output value.
- **Agent slug:** resolved by normalizing the existing `agents.name` (no new `slug` column) — chosen over the spec's "new column" default to minimize blast radius on the 9 duplicated test schemas.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Run server tests with: `cd apps/server && npx jest <file>` (single file) or `npx jest` (all).

---

## File Structure

**Create (server):**
- `apps/server/src/services/teams/slugify.ts` — `slugify(name)` + `AgentRepository.findBySlug` lives in repo; slugify is the shared util.
- `apps/server/src/services/teams/parseTeamsCommand.ts` — pure parser: raw text → `{ kind: 'help' | 'set-channel' | 'run', slug?, input? }`.
- `apps/server/src/services/teams/allowlist.ts` — `isAllowedUser(aadObjectId, config)`.
- `apps/server/src/services/teams/TeamsBot.ts` — `processTeamsMessage(turn, deps)` (pure, testable) + `createTeamsBot(deps)` (ActivityHandler that adapts `TurnContext` → `turn`).
- `apps/server/src/services/teams/TeamsNotifier.ts` — `createTeamsAdapter(config)`, `TeamsNotifier` (proactive send), `formatTeamsResult(result, agent)`.
- `apps/server/src/api/routes/teams.ts` — `POST /api/messages` route.
- `apps/server/src/db/migrations/0005_teams_integration.sql` — hand-written ALTERs.
- `apps/server/teams-app/manifest.json`, `apps/server/teams-app/README.md`, two PNG icons.
- `apps/server/teams-app/PROVISIONING.md` — discovery-spike outcome / IT escalation packet.
- Tests: `apps/server/test/teams/parseTeamsCommand.test.ts`, `allowlist.test.ts`, `slugify.test.ts`, `TeamsBot.test.ts`, `resultDispatcherTeams.test.ts`, `teamsRoute.test.ts`.

**Modify (server):**
- `apps/server/package.json` — add `botbuilder`.
- `apps/server/src/config/environment.ts` — Teams env vars + `teamsEnabled()`.
- `apps/server/src/db/schema.ts` — `agents.teamsTarget`, `runs.replyTo`.
- `apps/server/src/services/RunRepository.ts` — accept `replyTo` in `create`.
- `apps/server/src/services/AgentRepository.ts` — `findBySlug`, `setTeamsTarget`.
- `apps/server/src/services/ResultDispatcher.ts` — `teams` branch + notifier injection.
- `apps/server/src/api/routes/runs.ts` — pass notifier into dispatcher.
- `apps/server/src/app.ts` — register Teams route + startup column assertion when enabled.
- `.env.example` (repo root) — Teams vars.
- Test setups gaining `teams_target TEXT` on `agents`: `agentMemory.test.ts`, `agentRepository.test.ts`, `db.test.ts`, `agents.test.ts`, `WebhookMatcher.test.ts`, `migration.test.ts`, `runs.test.ts`.
- Test setups gaining `reply_to TEXT` on `runs`: `runRepository.test.ts`, `runs.test.ts`.

**Modify (client):**
- `apps/client/src/components/OutputSelector.tsx` — add `teams` option.
- `apps/client/src/pages/AgentConfigPage.tsx` — read-only `teamsTarget` indicator.

---

## Task 0: Provisioning discovery spike (manual — no code)

**Goal:** Resolve the tenant-permission unknown before/while code is written. Produces either working credentials or an IT escalation packet. Does NOT block Tasks 1–11 (all code is unit-testable without credentials); it blocks only Task 13 (manual E2E).

**Files:**
- Create: `apps/server/teams-app/PROVISIONING.md`

- [ ] **Step 1: Attempt Azure Bot + Entra app registration**

In the Azure Portal (or `az` CLI), attempt to create:
1. An **Entra app registration** (single-tenant). Record **Application (client) ID** and **Directory (tenant) ID**. Create a **client secret**; record its value.
2. An **Azure Bot** resource linked to that app. Set the **messaging endpoint** to `https://<your-tunnel-host>/api/messages` (placeholder until the tunnel is up in Task 12). Enable the **Microsoft Teams** channel.

- [ ] **Step 2: Check Teams custom-app sideloading**

In Teams Admin Center → Teams apps → Setup policies, confirm "Upload custom apps" is allowed for your account (or ask whether it can be enabled).

- [ ] **Step 3: Record the outcome**

Write `apps/server/teams-app/PROVISIONING.md` with ONE of:
- **Unblocked:** note that App ID / tenant ID / secret exist (store the secret in `.env`, NOT in the doc) and sideloading is allowed. Proceed normally.
- **Blocked:** a copy-pasteable escalation packet for IT: requested Azure Bot name, app-registration type (`SingleTenant`), messaging endpoint URL pattern, required: a client secret, the Teams channel enabled, and "Upload custom apps" enabled for the requester. Note the fallback (Power Automate bridge, spec approach C) if an Azure Bot is refused.

- [ ] **Step 4: Commit**

```bash
git add apps/server/teams-app/PROVISIONING.md
git commit -m "docs: Teams provisioning discovery outcome"
```

---

## Task 1: Teams env config + feature gate + botbuilder dependency

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/config/environment.ts`
- Modify: `.env.example` (repo root)
- Test: `apps/server/test/teams/config.test.ts`

**Interfaces:**
- Produces: `Environment` extended with `MICROSOFT_APP_ID/PASSWORD/TENANT_ID/APP_TYPE: string | undefined` and `TEAMS_ALLOWED_USER_IDS: string[]`; `teamsEnabled(config: Environment): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/config.test.ts`:

```ts
import { loadConfig, teamsEnabled } from '../../src/config/environment.js';

describe('Teams config', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('parses TEAMS_ALLOWED_USER_IDS into a trimmed array', () => {
    process.env = { ...OLD, MICROSOFT_APP_ID: 'app', TEAMS_ALLOWED_USER_IDS: 'a, b ,c' };
    const cfg = loadConfig();
    expect(cfg.TEAMS_ALLOWED_USER_IDS).toEqual(['a', 'b', 'c']);
  });

  it('teamsEnabled is false when MICROSOFT_APP_ID is unset', () => {
    process.env = { ...OLD, MICROSOFT_APP_ID: undefined };
    expect(teamsEnabled(loadConfig())).toBe(false);
  });

  it('teamsEnabled is true when MICROSOFT_APP_ID is set', () => {
    process.env = { ...OLD, MICROSOFT_APP_ID: 'app' };
    expect(teamsEnabled(loadConfig())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/teams/config.test.ts`
Expected: FAIL — `teamsEnabled` is not exported / fields missing.

- [ ] **Step 3: Extend the config**

In `apps/server/src/config/environment.ts`, add to the `Environment` type:

```ts
  MICROSOFT_APP_ID: string | undefined;
  MICROSOFT_APP_PASSWORD: string | undefined;
  MICROSOFT_APP_TENANT_ID: string | undefined;
  MICROSOFT_APP_TYPE: string | undefined;
  TEAMS_ALLOWED_USER_IDS: string[];
```

Add to the object built in `loadConfig()`:

```ts
    MICROSOFT_APP_ID: process.env.MICROSOFT_APP_ID,
    MICROSOFT_APP_PASSWORD: process.env.MICROSOFT_APP_PASSWORD,
    MICROSOFT_APP_TENANT_ID: process.env.MICROSOFT_APP_TENANT_ID,
    MICROSOFT_APP_TYPE: process.env.MICROSOFT_APP_TYPE ?? 'SingleTenant',
    TEAMS_ALLOWED_USER_IDS: (process.env.TEAMS_ALLOWED_USER_IDS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
```

Append at the end of the file:

```ts
export function teamsEnabled(config: Environment): boolean {
  return Boolean(config.MICROSOFT_APP_ID);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/teams/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the dependency**

In `apps/server/package.json`, add to `dependencies` (keep alphabetical):

```json
    "botbuilder": "^4.23.0",
```

Run: `cd apps/server && npm install`
Expected: installs without errors.

- [ ] **Step 6: Document env vars**

In repo-root `.env.example`, append:

```
# Microsoft Teams bot (feature is OFF unless MICROSOFT_APP_ID is set)
MICROSOFT_APP_ID=
MICROSOFT_APP_PASSWORD=
MICROSOFT_APP_TENANT_ID=
MICROSOFT_APP_TYPE=SingleTenant
TEAMS_ALLOWED_USER_IDS=
```

- [ ] **Step 7: Run the full server suite (no regressions)**

Run: `cd apps/server && npx jest`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/package.json apps/server/package-lock.json apps/server/src/config/environment.ts apps/server/test/teams/config.test.ts .env.example
git commit -m "feat(teams): add Teams env config, feature gate, and botbuilder dep"
```

---

## Task 2: Schema columns + migration + RunRepository.replyTo

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/migrations/0005_teams_integration.sql`
- Modify: `apps/server/src/services/RunRepository.ts`
- Modify (test in-memory `agents` schema, add `teams_target TEXT`): `apps/server/test/agentMemory.test.ts`, `agentRepository.test.ts`, `db.test.ts`, `agents.test.ts`, `WebhookMatcher.test.ts`, `migration.test.ts`, `runs.test.ts`
- Modify (test in-memory `runs` schema, add `reply_to TEXT`): `apps/server/test/runRepository.test.ts`, `runs.test.ts`
- Test: `apps/server/test/teams/runReplyTo.test.ts`

**Interfaces:**
- Produces: `agents.teamsTarget: text (nullable)`, `runs.replyTo: text (nullable)`; `RunRepository.create` accepts optional `replyTo`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/runReplyTo.test.ts`:

```ts
import { getDb, resetDb } from '../../src/db/client.js';
import { RunRepository } from '../../src/services/RunRepository.js';

beforeEach(() => {
  resetDb();
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT, result TEXT,
      error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, session_id TEXT,
      pending_gate TEXT, pending_response TEXT, reply_to TEXT
    )
  `);
});
afterAll(() => resetDb());

it('persists replyTo when provided', () => {
  const run = RunRepository.create({
    agentId: 'a1', trigger: 'teams', triggerPayload: '{}', context: 'hi',
    replyTo: '{"conversation":{"id":"c1"}}',
  });
  expect(RunRepository.findById(run.id)?.replyTo).toBe('{"conversation":{"id":"c1"}}');
});

it('defaults replyTo to null when omitted', () => {
  const run = RunRepository.create({ agentId: 'a1', trigger: 'manual', triggerPayload: '{}', context: '{}' });
  expect(RunRepository.findById(run.id)?.replyTo).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/teams/runReplyTo.test.ts`
Expected: FAIL — `replyTo` not accepted / `no such column: reply_to`.

- [ ] **Step 3: Add schema columns**

In `apps/server/src/db/schema.ts`, in the `agents` table add after `workflow`:

```ts
  teamsTarget: text('teams_target'),
```

In the `runs` table add after `pendingResponse`:

```ts
  replyTo: text('reply_to'),
```

- [ ] **Step 4: Extend RunRepository.create**

In `apps/server/src/services/RunRepository.ts`, change the `create` signature and row:

```ts
  create(data: Pick<RunRow, 'agentId' | 'trigger' | 'triggerPayload' | 'context'> & { replyTo?: string | null }): RunRow {
    const row: RunRow = {
      id: randomUUID(),
      status: 'pending',
      runnerId: null,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      archived: false,
      createdAt: new Date().toISOString(),
      sessionId: null,
      pendingGate: null,
      pendingResponse: null,
      replyTo: null,
      ...data,
    };
    getDb().insert(runs).values(row).run();
    return row;
  },
```

In `createCompleted`, add `replyTo: null,` to its row object (so the typed `RunRow` is complete).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/server && npx jest test/teams/runReplyTo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add `teams_target TEXT` to every in-memory `agents` table**

In each of `agentMemory.test.ts`, `agentRepository.test.ts`, `db.test.ts`, `agents.test.ts`, `WebhookMatcher.test.ts`, `migration.test.ts`, `runs.test.ts`: in the `CREATE TABLE ... agents (` block, add a `teams_target TEXT` column right after the `workflow TEXT` line (add a trailing comma to `workflow TEXT` where needed). Example (matches `agents.test.ts`):

```sql
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT,
      teams_target TEXT
```

- [ ] **Step 7: Add `reply_to TEXT` to every in-memory `runs` table**

In `runRepository.test.ts` and `runs.test.ts`, in the `CREATE TABLE ... runs (` block add `reply_to TEXT` as the final column (comma after `pending_response TEXT`).

- [ ] **Step 8: Write the hand-written migration**

Create `apps/server/src/db/migrations/0005_teams_integration.sql`:

```sql
ALTER TABLE `agents` ADD `teams_target` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `reply_to` text;
```

- [ ] **Step 9: Check migration.test.ts expectations**

Open `apps/server/test/migration.test.ts`. If it asserts a fixed migration-file count or a specific schema snapshot, update that expectation to include `0005_teams_integration.sql`. Run it: `cd apps/server && npx jest test/migration.test.ts` → PASS.

- [ ] **Step 10: Run the full server suite**

Run: `cd apps/server && npx jest`
Expected: all PASS (no `no such column` regressions).

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/migrations/0005_teams_integration.sql apps/server/src/services/RunRepository.ts apps/server/test
git commit -m "feat(teams): add teams_target/reply_to columns and migration"
```

---

## Task 3: slugify util + AgentRepository.findBySlug + setTeamsTarget

**Files:**
- Create: `apps/server/src/services/teams/slugify.ts`
- Modify: `apps/server/src/services/AgentRepository.ts`
- Test: `apps/server/test/teams/slugify.test.ts`, `apps/server/test/teams/agentFindBySlug.test.ts`

**Interfaces:**
- Produces: `slugify(name: string): string`; `AgentRepository.findBySlug(slug: string): AgentRow | null`; `AgentRepository.setTeamsTarget(id: string, ref: string): AgentRow | null`.
- Consumes: `AgentRow` from `AgentRepository`.

- [ ] **Step 1: Write the failing slugify test**

Create `apps/server/test/teams/slugify.test.ts`:

```ts
import { slugify } from '../../src/services/teams/slugify.js';

it('lowercases and hyphenates', () => {
  expect(slugify('PR Review')).toBe('pr-review');
  expect(slugify('Code  Reviewer!')).toBe('code-reviewer');
  expect(slugify('  Bug Hunter  ')).toBe('bug-hunter');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/slugify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement slugify**

Create `apps/server/src/services/teams/slugify.ts`:

```ts
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/slugify.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing findBySlug/setTeamsTarget test**

Create `apps/server/test/teams/agentFindBySlug.test.ts`:

```ts
import { getDb, resetDb } from '../../src/db/client.js';
import { AgentRepository } from '../../src/services/AgentRepository.js';

beforeEach(() => {
  resetDb();
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, model TEXT NOT NULL,
      prompt TEXT NOT NULL, repos TEXT NOT NULL, trigger_rules TEXT NOT NULL,
      outputs TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT, skills TEXT NOT NULL DEFAULT '[]', focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT, teams_target TEXT
    )
  `);
});
afterAll(() => resetDb());

function make(name: string) {
  return AgentRepository.create({
    name, type: 'pr-review', model: 'm', prompt: 'p',
    repos: '[]', triggerRules: '{}', outputs: '[]',
  } as any);
}

it('finds an agent by slugified name', () => {
  const a = make('PR Review');
  expect(AgentRepository.findBySlug('pr-review')?.id).toBe(a.id);
  expect(AgentRepository.findBySlug('nope')).toBeNull();
});

it('ignores archived agents', () => {
  const a = make('Archived One');
  AgentRepository.setArchived(a.id, true);
  expect(AgentRepository.findBySlug('archived-one')).toBeNull();
});

it('setTeamsTarget persists a conversation reference', () => {
  const a = make('Reporter');
  AgentRepository.setTeamsTarget(a.id, '{"conversation":{"id":"ch1"}}');
  expect(AgentRepository.findById(a.id)?.teamsTarget).toBe('{"conversation":{"id":"ch1"}}');
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/agentFindBySlug.test.ts`
Expected: FAIL — `findBySlug`/`setTeamsTarget` not functions.

- [ ] **Step 7: Implement repository methods**

In `apps/server/src/services/AgentRepository.ts`, add the import at top:

```ts
import { slugify } from './teams/slugify.js';
```

Add these methods to the `AgentRepository` object (before the closing `}`):

```ts
  findBySlug(slug: string): AgentRow | null {
    const target = slug.trim().toLowerCase();
    const all = getDb().select().from(agents).where(eq(agents.archived, false)).all();
    return all.find(a => slugify(a.name) === target) ?? null;
  },
  setTeamsTarget(id: string, ref: string): AgentRow | null {
    const db = getDb();
    db.update(agents).set({ teamsTarget: ref }).where(eq(agents.id, id)).run();
    return db.select().from(agents).where(eq(agents.id, id)).get() ?? null;
  },
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/agentFindBySlug.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/services/teams/slugify.ts apps/server/src/services/AgentRepository.ts apps/server/test/teams/slugify.test.ts apps/server/test/teams/agentFindBySlug.test.ts
git commit -m "feat(teams): slugify util, AgentRepository.findBySlug and setTeamsTarget"
```

---

## Task 4: Message parser

**Files:**
- Create: `apps/server/src/services/teams/parseTeamsCommand.ts`
- Test: `apps/server/test/teams/parseTeamsCommand.test.ts`

**Interfaces:**
- Produces: `parseTeamsCommand(text: string): TeamsCommand` where
  `type TeamsCommand = { kind: 'help' } | { kind: 'set-channel'; slug: string } | { kind: 'run'; slug: string; input: string } | { kind: 'invalid'; reason: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/parseTeamsCommand.test.ts`:

```ts
import { parseTeamsCommand } from '../../src/services/teams/parseTeamsCommand.js';

describe('parseTeamsCommand', () => {
  it('treats empty / whitespace as help', () => {
    expect(parseTeamsCommand('')).toEqual({ kind: 'help' });
    expect(parseTeamsCommand('   ')).toEqual({ kind: 'help' });
    expect(parseTeamsCommand('help')).toEqual({ kind: 'help' });
  });

  it('parses set-channel', () => {
    expect(parseTeamsCommand('set-channel pr-review')).toEqual({ kind: 'set-channel', slug: 'pr-review' });
  });

  it('reports invalid set-channel without a slug', () => {
    expect(parseTeamsCommand('set-channel')).toEqual({ kind: 'invalid', reason: 'set-channel needs an agent slug' });
  });

  it('parses "<slug>: <input>"', () => {
    expect(parseTeamsCommand('pr-review: check MR 42')).toEqual({ kind: 'run', slug: 'pr-review', input: 'check MR 42' });
  });

  it('parses "<slug> <input>" without a colon', () => {
    expect(parseTeamsCommand('code-reviewer look at this')).toEqual({ kind: 'run', slug: 'code-reviewer', input: 'look at this' });
  });

  it('strips residual <at> mention markup and extra whitespace', () => {
    expect(parseTeamsCommand('<at>Agent Hub</at>  pr-review:  hello ')).toEqual({ kind: 'run', slug: 'pr-review', input: 'hello' });
  });

  it('reports invalid when only a slug is given', () => {
    expect(parseTeamsCommand('pr-review')).toEqual({ kind: 'invalid', reason: 'No input provided for agent "pr-review"' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/parseTeamsCommand.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `apps/server/src/services/teams/parseTeamsCommand.ts`:

```ts
export type TeamsCommand =
  | { kind: 'help' }
  | { kind: 'set-channel'; slug: string }
  | { kind: 'run'; slug: string; input: string }
  | { kind: 'invalid'; reason: string };

export function parseTeamsCommand(raw: string): TeamsCommand {
  // Strip any residual <at>…</at> mention markup botbuilder may leave, collapse whitespace.
  const text = raw.replace(/<at>.*?<\/at>/gi, ' ').replace(/\s+/g, ' ').trim();

  if (text === '' || text.toLowerCase() === 'help') return { kind: 'help' };

  if (text.toLowerCase().startsWith('set-channel')) {
    const slug = text.slice('set-channel'.length).trim();
    if (!slug) return { kind: 'invalid', reason: 'set-channel needs an agent slug' };
    return { kind: 'set-channel', slug: slug.split(/\s+/)[0] };
  }

  // "<slug>: <input>" or "<slug> <input>"
  const colon = text.indexOf(':');
  if (colon > 0) {
    const slug = text.slice(0, colon).trim().split(/\s+/)[0];
    const input = text.slice(colon + 1).trim();
    if (!input) return { kind: 'invalid', reason: `No input provided for agent "${slug}"` };
    return { kind: 'run', slug, input };
  }

  const [slug, ...rest] = text.split(' ');
  const input = rest.join(' ').trim();
  if (!input) return { kind: 'invalid', reason: `No input provided for agent "${slug}"` };
  return { kind: 'run', slug, input };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/parseTeamsCommand.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/teams/parseTeamsCommand.ts apps/server/test/teams/parseTeamsCommand.test.ts
git commit -m "feat(teams): inbound message parser"
```

---

## Task 5: Allowlist gate

**Files:**
- Create: `apps/server/src/services/teams/allowlist.ts`
- Test: `apps/server/test/teams/allowlist.test.ts`

**Interfaces:**
- Produces: `isAllowedUser(aadObjectId: string | undefined, allowed: string[]): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/allowlist.test.ts`:

```ts
import { isAllowedUser } from '../../src/services/teams/allowlist.js';

it('allows ids in the list, denies others and undefined', () => {
  expect(isAllowedUser('u1', ['u1', 'u2'])).toBe(true);
  expect(isAllowedUser('u3', ['u1', 'u2'])).toBe(false);
  expect(isAllowedUser(undefined, ['u1'])).toBe(false);
});

it('denies everyone when the allowlist is empty', () => {
  expect(isAllowedUser('u1', [])).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/allowlist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/server/src/services/teams/allowlist.ts`:

```ts
export function isAllowedUser(aadObjectId: string | undefined, allowed: string[]): boolean {
  if (!aadObjectId) return false;
  return allowed.includes(aadObjectId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/allowlist.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/teams/allowlist.ts apps/server/test/teams/allowlist.test.ts
git commit -m "feat(teams): allowlist gate"
```

---

## Task 6: TeamsBot core (processTeamsMessage)

**Files:**
- Create: `apps/server/src/services/teams/TeamsBot.ts`
- Test: `apps/server/test/teams/TeamsBot.test.ts`

**Interfaces:**
- Consumes: `parseTeamsCommand` (Task 4), `isAllowedUser` (Task 5), `AgentRepository.findBySlug/setTeamsTarget/findAll` (Task 3), `RunRepository.create` with `replyTo` (Task 2).
- Produces:
  - `interface TeamsTurn { text: string; aadObjectId: string | undefined; conversationReference: string; reply(text: string): Promise<void>; }` (`conversationReference` is the JSON-serialized `ConversationReference`).
  - `interface TeamsBotDeps { allowedUserIds: string[]; agents: { findBySlug(s: string): { id: string; name: string } | null; setTeamsTarget(id: string, ref: string): unknown; listSlugs(): string[]; }; runs: { create(d: { agentId: string; trigger: string; triggerPayload: string; context: string; replyTo: string }): { id: string }; }; }`
  - `processTeamsMessage(turn: TeamsTurn, deps: TeamsBotDeps): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/TeamsBot.test.ts`:

```ts
import { processTeamsMessage, type TeamsTurn, type TeamsBotDeps } from '../../src/services/teams/TeamsBot.js';

function makeTurn(over: Partial<TeamsTurn> = {}): { turn: TeamsTurn; replies: string[] } {
  const replies: string[] = [];
  const turn: TeamsTurn = {
    text: 'pr-review: do it',
    aadObjectId: 'u1',
    conversationReference: '{"conversation":{"id":"c1"}}',
    reply: async (t: string) => { replies.push(t); },
    ...over,
  };
  return { turn, replies };
}

function makeDeps(over: Partial<TeamsBotDeps> = {}): { deps: TeamsBotDeps; created: any[]; targets: any[] } {
  const created: any[] = [];
  const targets: any[] = [];
  const deps: TeamsBotDeps = {
    allowedUserIds: ['u1'],
    agents: {
      findBySlug: (s) => (s === 'pr-review' ? { id: 'agent-1', name: 'PR Review' } : null),
      setTeamsTarget: (id, ref) => { targets.push({ id, ref }); return {}; },
      listSlugs: () => ['pr-review', 'code-reviewer'],
    },
    runs: { create: (d) => { created.push(d); return { id: 'run-1' }; } },
    ...over,
  };
  return { deps, created, targets };
}

describe('processTeamsMessage', () => {
  it('denies users not on the allowlist', async () => {
    const { turn, replies } = makeTurn({ aadObjectId: 'intruder' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created).toHaveLength(0);
    expect(replies[0]).toMatch(/not authorized/i);
  });

  it('creates a run with replyTo and acks for a valid command', async () => {
    const { turn, replies } = makeTurn();
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created[0]).toMatchObject({
      agentId: 'agent-1', trigger: 'teams', context: 'do it',
      replyTo: '{"conversation":{"id":"c1"}}',
    });
    expect(replies[0]).toMatch(/running/i);
  });

  it('replies with the agent list on help', async () => {
    const { turn, replies } = makeTurn({ text: 'help' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created).toHaveLength(0);
    expect(replies[0]).toMatch(/pr-review/);
  });

  it('handles set-channel by saving the conversation reference', async () => {
    const { turn, replies } = makeTurn({ text: 'set-channel pr-review' });
    const { deps, targets } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(targets[0]).toEqual({ id: 'agent-1', ref: '{"conversation":{"id":"c1"}}' });
    expect(replies[0]).toMatch(/will post here/i);
  });

  it('errors clearly for an unknown slug', async () => {
    const { turn, replies } = makeTurn({ text: 'ghost: hi' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created).toHaveLength(0);
    expect(replies[0]).toMatch(/unknown agent/i);
  });

  it('does not throw if the ack reply fails after the run is created', async () => {
    const { turn } = makeTurn({ reply: async () => { throw new Error('teams down'); } });
    const { deps, created } = makeDeps();
    await expect(processTeamsMessage(turn, deps)).resolves.toBeUndefined();
    expect(created).toHaveLength(1); // run still created
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/TeamsBot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bot core**

Create `apps/server/src/services/teams/TeamsBot.ts`:

```ts
import { parseTeamsCommand } from './parseTeamsCommand.js';
import { isAllowedUser } from './allowlist.js';

export interface TeamsTurn {
  text: string;
  aadObjectId: string | undefined;
  conversationReference: string; // JSON-serialized ConversationReference
  reply(text: string): Promise<void>;
}

export interface TeamsBotDeps {
  allowedUserIds: string[];
  agents: {
    findBySlug(slug: string): { id: string; name: string } | null;
    setTeamsTarget(id: string, ref: string): unknown;
    listSlugs(): string[];
  };
  runs: {
    create(d: { agentId: string; trigger: string; triggerPayload: string; context: string; replyTo: string }): { id: string };
  };
}

// Best-effort reply that never throws — used for acks/errors so a Teams send
// failure can't abort the turn after a run is already created.
async function safeReply(turn: TeamsTurn, text: string): Promise<void> {
  try { await turn.reply(text); } catch (e) { console.error('[TeamsBot] reply failed:', e); }
}

export async function processTeamsMessage(turn: TeamsTurn, deps: TeamsBotDeps): Promise<void> {
  if (!isAllowedUser(turn.aadObjectId, deps.allowedUserIds)) {
    await safeReply(turn, "You're not authorized to trigger agents.");
    return;
  }

  const cmd = parseTeamsCommand(turn.text);

  if (cmd.kind === 'help') {
    await safeReply(turn, helpText(deps.agents.listSlugs()));
    return;
  }
  if (cmd.kind === 'invalid') {
    await safeReply(turn, `${cmd.reason}\n\n${helpText(deps.agents.listSlugs())}`);
    return;
  }
  if (cmd.kind === 'set-channel') {
    const agent = deps.agents.findBySlug(cmd.slug);
    if (!agent) { await safeReply(turn, unknownAgent(cmd.slug, deps.agents.listSlugs())); return; }
    deps.agents.setTeamsTarget(agent.id, turn.conversationReference);
    await safeReply(turn, `✅ Reports for \`${cmd.slug}\` will post here.`);
    return;
  }

  // cmd.kind === 'run'
  const agent = deps.agents.findBySlug(cmd.slug);
  if (!agent) { await safeReply(turn, unknownAgent(cmd.slug, deps.agents.listSlugs())); return; }

  deps.runs.create({
    agentId: agent.id,
    trigger: 'teams',
    triggerPayload: JSON.stringify({ source: 'teams', aadObjectId: turn.aadObjectId }),
    context: cmd.input,
    replyTo: turn.conversationReference,
  });

  await safeReply(turn, `🚀 Running \`${cmd.slug}\`… I'll post the result here.`);
}

function helpText(slugs: string[]): string {
  const list = slugs.length ? slugs.map(s => `• \`${s}\``).join('\n') : '_(no agents configured)_';
  return `Available agents:\n${list}\n\nUsage: \`<slug>: <your request>\`  ·  \`set-channel <slug>\`  ·  \`help\``;
}

function unknownAgent(slug: string, slugs: string[]): string {
  return `Unknown agent \`${slug}\`.\n\n${helpText(slugs)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/TeamsBot.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/teams/TeamsBot.ts apps/server/test/teams/TeamsBot.test.ts
git commit -m "feat(teams): TeamsBot message-processing core"
```

---

## Task 7: TeamsNotifier + adapter factory + result formatting

**Files:**
- Create: `apps/server/src/services/teams/TeamsNotifier.ts`
- Test: `apps/server/test/teams/teamsNotifier.test.ts`

**Interfaces:**
- Consumes: `Environment` (Task 1).
- Produces:
  - `createTeamsAdapter(config: Environment): CloudAdapter` (throws if Teams not configured).
  - `formatTeamsResult(result: string, agentName: string): string`.
  - `class TeamsNotifier { constructor(adapter: { continueConversationAsync: Function }, appId: string); post(ref: object, text: string): Promise<void>; }`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/teamsNotifier.test.ts`:

```ts
import { TeamsNotifier, formatTeamsResult } from '../../src/services/teams/TeamsNotifier.js';

describe('formatTeamsResult', () => {
  it('prefixes the agent name', () => {
    expect(formatTeamsResult('all good', 'PR Review')).toMatch(/PR Review/);
    expect(formatTeamsResult('all good', 'PR Review')).toMatch(/all good/);
  });
  it('truncates very long results', () => {
    const out = formatTeamsResult('x'.repeat(50_000), 'A');
    expect(out.length).toBeLessThan(20_000);
    expect(out).toMatch(/truncated/i);
  });
});

describe('TeamsNotifier.post', () => {
  it('continues the conversation and sends the text', async () => {
    const calls: any[] = [];
    const fakeAdapter = {
      continueConversationAsync: async (appId: string, ref: object, logic: Function) => {
        calls.push({ appId, ref });
        await logic({ sendActivity: async (t: string) => calls.push({ sent: t }) });
      },
    };
    const notifier = new TeamsNotifier(fakeAdapter as any, 'app-1');
    await notifier.post({ conversation: { id: 'c1' } }, 'hello');
    expect(calls[0]).toMatchObject({ appId: 'app-1', ref: { conversation: { id: 'c1' } } });
    expect(calls[1]).toEqual({ sent: 'hello' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/teamsNotifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/server/src/services/teams/TeamsNotifier.ts`:

```ts
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
  type TurnContext,
} from 'botbuilder';
import type { Environment } from '../../config/environment.js';

const MAX_LEN = 18_000;

export function formatTeamsResult(result: string, agentName: string): string {
  let body = result;
  if (body.length > MAX_LEN) body = body.slice(0, MAX_LEN) + '\n\n…(truncated)';
  return `**${agentName}** finished:\n\n${body}`;
}

export function createTeamsAdapter(config: Environment): CloudAdapter {
  if (!config.MICROSOFT_APP_ID) throw new Error('createTeamsAdapter called without MICROSOFT_APP_ID');
  const auth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: config.MICROSOFT_APP_ID,
    MicrosoftAppPassword: config.MICROSOFT_APP_PASSWORD,
    MicrosoftAppType: config.MICROSOFT_APP_TYPE,
    MicrosoftAppTenantId: config.MICROSOFT_APP_TENANT_ID,
  } as Record<string, string | undefined>);
  return new CloudAdapter(auth);
}

interface AdapterLike {
  continueConversationAsync(
    appId: string,
    ref: Partial<ConversationReference>,
    logic: (ctx: TurnContext) => Promise<void>,
  ): Promise<void>;
}

export class TeamsNotifier {
  constructor(private adapter: AdapterLike, private appId: string) {}

  async post(ref: Partial<ConversationReference>, text: string): Promise<void> {
    await this.adapter.continueConversationAsync(this.appId, ref, async (ctx) => {
      await ctx.sendActivity(text);
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/teamsNotifier.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/teams/TeamsNotifier.ts apps/server/test/teams/teamsNotifier.test.ts
git commit -m "feat(teams): TeamsNotifier, adapter factory, result formatting"
```

---

## Task 8: ResultDispatcher `teams` output + runs.ts wiring

**Files:**
- Modify: `apps/server/src/services/ResultDispatcher.ts`
- Modify: `apps/server/src/api/routes/runs.ts`
- Test: `apps/server/test/teams/resultDispatcherTeams.test.ts`

**Interfaces:**
- Consumes: `TeamsNotifier` (Task 7), `RunRow.replyTo` (Task 2), `AgentRow.teamsTarget` (Task 2).
- Produces: `ResultDispatcher` constructor accepts an optional 4th arg `teamsNotifier?: { post(ref: object, text: string): Promise<void> }`; the `teams` output branch routes `run.replyTo ?? agent.teamsTarget`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/teams/resultDispatcherTeams.test.ts`:

```ts
import { ResultDispatcher } from '../../src/services/ResultDispatcher.js';

function run(over: any = {}) {
  return { id: 'r1', result: 'the result', triggerPayload: '{}', replyTo: null, ...over } as any;
}
function agent(over: any = {}) {
  return { id: 'a1', name: 'PR Review', outputs: JSON.stringify(['teams']), teamsTarget: null, ...over } as any;
}

describe('ResultDispatcher teams output', () => {
  it('posts to run.replyTo when present', async () => {
    const posts: any[] = [];
    const notifier = { post: async (ref: any, text: string) => { posts.push({ ref, text }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, notifier);
    await d.dispatch(run({ replyTo: '{"conversation":{"id":"c1"}}' }), agent());
    expect(posts).toHaveLength(1);
    expect(posts[0].ref).toEqual({ conversation: { id: 'c1' } });
    expect(posts[0].text).toMatch(/the result/);
  });

  it('falls back to agent.teamsTarget when replyTo is null', async () => {
    const posts: any[] = [];
    const notifier = { post: async (ref: any, text: string) => { posts.push({ ref, text }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, notifier);
    await d.dispatch(run(), agent({ teamsTarget: '{"conversation":{"id":"ch1"}}' }));
    expect(posts[0].ref).toEqual({ conversation: { id: 'ch1' } });
  });

  it('does nothing when there is no target', async () => {
    const posts: any[] = [];
    const notifier = { post: async (ref: any, text: string) => { posts.push({ ref, text }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, notifier);
    await d.dispatch(run(), agent());
    expect(posts).toHaveLength(0);
  });

  it('skips the teams branch when no notifier is wired', async () => {
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined);
    await expect(d.dispatch(run({ replyTo: '{"conversation":{"id":"c1"}}' }), agent())).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/resultDispatcherTeams.test.ts`
Expected: FAIL — constructor doesn't accept a notifier / no `teams` branch.

- [ ] **Step 3: Implement the dispatcher branch**

In `apps/server/src/services/ResultDispatcher.ts`:

Add imports near the top:

```ts
import { formatTeamsResult } from './teams/TeamsNotifier.js';
```

Add a notifier type + field and extend the constructor:

```ts
interface TeamsNotifierLike { post(ref: object, text: string): Promise<void>; }

export class ResultDispatcher {
  private gitlab?: GitLabClient;
  private jira?: JiraClient;
  private teams?: TeamsNotifierLike;

  constructor(gitlabToken?: string, jiraToken?: string, jiraBaseUrl?: string, teamsNotifier?: TeamsNotifierLike) {
    if (gitlabToken) this.gitlab = new GitLabClient(gitlabToken);
    if (jiraToken && jiraBaseUrl) this.jira = new JiraClient(jiraToken, jiraBaseUrl);
    this.teams = teamsNotifier;
  }
```

Inside the `for (const output of outputs)` loop, add:

```ts
      if (output === 'teams' && this.teams) {
        await this.postTeams(run, agent).catch(e =>
          console.error('[ResultDispatcher] teams failed:', e)
        );
      }
```

Add the private method:

```ts
  private async postTeams(run: RunRow, agent: AgentRow): Promise<void> {
    if (!this.teams || !run.result) return;
    const refJson = run.replyTo ?? agent.teamsTarget;
    if (!refJson) {
      console.warn('[ResultDispatcher] teams output set but no target for agent', agent.id);
      return;
    }
    await this.teams.post(JSON.parse(refJson), formatTeamsResult(run.result, agent.name));
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/server && npx jest test/teams/resultDispatcherTeams.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the notifier into runs.ts**

In `apps/server/src/api/routes/runs.ts`, the dispatcher is constructed per result POST. Pass an optional notifier the route receives from the app. Change the route factory signature:

```ts
import type { TeamsNotifier } from '../../services/teams/TeamsNotifier.js';

export function buildRunsRoutes(config: Environment, teamsNotifier?: TeamsNotifier): FastifyPluginAsyncTypebox {
```

Then in the result handler, pass it:

```ts
          const dispatcher = new ResultDispatcher(
            config.GITLAB_API_TOKEN,
            config.JIRA_API_TOKEN,
            config.JIRA_BASE_URL,
            teamsNotifier,
          );
```

- [ ] **Step 6: Run the full server suite**

Run: `cd apps/server && npx jest`
Expected: all PASS (existing `runs.ts` callers still compile — `teamsNotifier` is optional).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/ResultDispatcher.ts apps/server/src/api/routes/runs.ts apps/server/test/teams/resultDispatcherTeams.test.ts
git commit -m "feat(teams): ResultDispatcher teams output and runs wiring"
```

---

## Task 9: `/api/messages` route + app wiring + startup column assertion

**Files:**
- Create: `apps/server/src/api/routes/teams.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/teams/teamsRoute.test.ts`

**Interfaces:**
- Consumes: `teamsEnabled`/`Environment` (Task 1), `createTeamsAdapter`/`TeamsNotifier` (Task 7), `createTeamsBot` (added here), `buildRunsRoutes(config, notifier)` (Task 8).
- Produces: `buildTeamsRoutes(config, adapter, bot): FastifyPluginAsyncTypebox`; `createTeamsBot(deps)` (ActivityHandler) in `TeamsBot.ts`; `assertTeamsColumns(db)` in `app.ts` helper.

- [ ] **Step 1: Add `createTeamsBot` (ActivityHandler) to TeamsBot.ts**

Append to `apps/server/src/services/teams/TeamsBot.ts`:

```ts
import { ActivityHandler, TurnContext } from 'botbuilder';
import { AgentRepository } from '../AgentRepository.js';
import { RunRepository } from '../RunRepository.js';
import { slugify } from './slugify.js';

export function createTeamsBot(allowedUserIds: string[]): ActivityHandler {
  const bot = new ActivityHandler();
  const deps: TeamsBotDeps = {
    allowedUserIds,
    agents: {
      findBySlug: (s) => AgentRepository.findBySlug(s),
      setTeamsTarget: (id, ref) => AgentRepository.setTeamsTarget(id, ref),
      listSlugs: () => AgentRepository.findAll().map(a => slugify(a.name)),
    },
    runs: { create: (d) => RunRepository.create(d) },
  };

  bot.onMessage(async (context, next) => {
    const turn: TeamsTurn = {
      text: TurnContext.removeRecipientMention(context.activity) ?? context.activity.text ?? '',
      aadObjectId: context.activity.from?.aadObjectId,
      conversationReference: JSON.stringify(TurnContext.getConversationReference(context.activity)),
      reply: async (t: string) => { await context.sendActivity(t); },
    };
    await processTeamsMessage(turn, deps);
    await next();
  });

  return bot;
}
```

Note: keep the existing pure exports (`processTeamsMessage`, `TeamsTurn`, `TeamsBotDeps`) — `createTeamsBot` is the thin adapter over them.

- [ ] **Step 2: Write the failing route test**

Create `apps/server/test/teams/teamsRoute.test.ts`:

```ts
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/environment.js';
import { getDb, resetDb } from '../../src/db/client.js';

afterEach(() => resetDb());

it('does not register /api/messages when Teams is disabled', async () => {
  const cfg = { ...loadConfig(), MICROSOFT_APP_ID: undefined } as any;
  getDb(':memory:');
  const app = buildApp(cfg);
  const res = await app.inject({ method: 'POST', url: '/api/messages', payload: {} });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/server && npx jest test/teams/teamsRoute.test.ts`
Expected: FAIL — currently `/api/messages` is unregistered so it 404s already; this test will PASS immediately. That's acceptable — it locks in the gated-off behavior. If it errors on import, fix the import path. (This task's real deliverable is the enabled path, exercised manually in Task 13.)

- [ ] **Step 4: Implement the route**

Create `apps/server/src/api/routes/teams.ts`:

```ts
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { CloudAdapter } from 'botbuilder';
import type { ActivityHandler } from 'botbuilder';

export function buildTeamsRoutes(adapter: CloudAdapter, bot: ActivityHandler): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post('/api/messages', { schema: { body: Type.Any() } }, async (req, reply) => {
      // CloudAdapter writes directly to the raw Node response; tell Fastify to back off.
      reply.hijack();
      await adapter.process(req.raw, reply.raw, (context) => bot.run(context));
    });
  };
}
```

- [ ] **Step 5: Wire app.ts (gated) + startup column assertion**

In `apps/server/src/app.ts`:

Add imports:

```ts
import { teamsEnabled } from './config/environment.js';
import { buildTeamsRoutes } from './api/routes/teams.js';
import { createTeamsAdapter, TeamsNotifier } from './services/teams/TeamsNotifier.js';
import { createTeamsBot } from './services/teams/TeamsBot.js';
import { getDb } from './db/client.js';
```

Add the assertion helper (above `buildApp`):

```ts
function assertTeamsColumns(): void {
  const db = getDb();
  const sqlite = (db as any).$client as import('better-sqlite3').Database;
  const has = (table: string, col: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === col);
  if (!has('agents', 'teams_target') || !has('runs', 'reply_to')) {
    throw new Error(
      'Teams is enabled but DB is missing teams_target/reply_to columns. ' +
      'Apply migration 0005_teams_integration.sql to agent-hub.db (server stopped) before starting.',
    );
  }
}
```

Replace the runs registration and add the Teams block in `buildApp`:

```ts
  let teamsNotifier: TeamsNotifier | undefined;
  if (teamsEnabled(config)) {
    assertTeamsColumns();
    const adapter = createTeamsAdapter(config);
    adapter.onTurnError = async (context, error) => {
      app.log.error(error, 'Teams turn error');
      await context.sendActivity('Sorry — something went wrong handling that.').catch(() => {});
    };
    const bot = createTeamsBot(config.TEAMS_ALLOWED_USER_IDS);
    teamsNotifier = new TeamsNotifier(adapter, config.MICROSOFT_APP_ID!);
    app.register(buildTeamsRoutes(adapter, bot));
  }

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(agentsRoutes);
  app.register(buildRunsRoutes(config, teamsNotifier));
  app.register(runnersRoutes);
  app.register(buildWebhooksRoutes(config));
  app.register(buildSkillsRoutes(config.SKILLS_DIR));
```

(Remove the old standalone `app.register(buildRunsRoutes(config));` line — it is replaced above.)

- [ ] **Step 6: Run the route test + full suite**

Run: `cd apps/server && npx jest test/teams/teamsRoute.test.ts`
Expected: PASS.
Run: `cd apps/server && npx jest`
Expected: all PASS.

- [ ] **Step 7: Build to confirm types compile**

Run: `cd apps/server && npx tsc --noEmit`
Expected: no errors. (If `req.raw`/`reply.raw` typing complains, ensure `@types/node` is present — it is in devDependencies.)

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/api/routes/teams.ts apps/server/src/app.ts apps/server/src/services/teams/TeamsBot.ts apps/server/test/teams/teamsRoute.test.ts
git commit -m "feat(teams): /api/messages route, gated app wiring, startup column assertion"
```

---

## Task 10: Client — Teams output option + target indicator

**Files:**
- Modify: `apps/client/src/components/OutputSelector.tsx`
- Modify: `apps/client/src/pages/AgentConfigPage.tsx`

**Interfaces:**
- Consumes: agent object from the agents API (now includes `teamsTarget`).

- [ ] **Step 1: Add the Teams output option**

In `apps/client/src/components/OutputSelector.tsx`, add to `OPTIONS`:

```ts
  { value: 'teams', label: 'Post result to Microsoft Teams' },
```

- [ ] **Step 2: Add the target indicator on the config page**

In `apps/client/src/pages/AgentConfigPage.tsx`, near where outputs are rendered, show whether a Teams channel target is configured. Locate the agent object in scope (e.g. `agent`) and add, beneath the `OutputSelector`:

```tsx
{agent?.outputs?.includes?.('teams') && (
  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
    {agent?.teamsTarget
      ? '✓ Teams report channel configured'
      : 'No report channel yet — run “set-channel <slug>” in the target Teams channel.'}
  </Typography>
)}
```

(If `outputs` is held in local form state as an array there, use that state variable instead of `agent.outputs`. Ensure `Typography` is imported from `@mui/material/Typography`.)

- [ ] **Step 3: Type-check the client**

Run: `cd apps/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual visual check**

Run the client dev server (`cd apps/client && npm run dev`), open an agent config, confirm the new "Post result to Microsoft Teams" checkbox appears and the indicator text shows when checked.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/components/OutputSelector.tsx apps/client/src/pages/AgentConfigPage.tsx
git commit -m "feat(teams): client output option and channel-target indicator"
```

---

## Task 11: Teams app package (manifest + icons + docs)

**Files:**
- Create: `apps/server/teams-app/manifest.json`
- Create: `apps/server/teams-app/color.png` (192×192), `apps/server/teams-app/outline.png` (32×32, transparent)
- Create: `apps/server/teams-app/README.md`

- [ ] **Step 1: Write the manifest**

Create `apps/server/teams-app/manifest.json` (replace `<MICROSOFT_APP_ID>` placeholders when packaging — they equal the bot's App ID):

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "<MICROSOFT_APP_ID>",
  "developer": {
    "name": "Global-E",
    "websiteUrl": "https://www.global-e.com",
    "privacyUrl": "https://www.global-e.com/privacy",
    "termsOfUseUrl": "https://www.global-e.com/terms"
  },
  "name": { "short": "Agent Hub", "full": "Global-E Agent Hub" },
  "description": {
    "short": "Talk to and get reports from Global-E agents.",
    "full": "Trigger Global-E agent-hub agents from Teams and receive their run results."
  },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#1F6FEB",
  "bots": [
    {
      "botId": "<MICROSOFT_APP_ID>",
      "scopes": ["personal", "team"],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": []
}
```

- [ ] **Step 2: Add the two icons**

Place a 192×192 `color.png` and a 32×32 transparent `outline.png` in `apps/server/teams-app/`. A simple solid-color icon with "AH" text is fine for v1.

- [ ] **Step 3: Write the README (dev loop)**

Create `apps/server/teams-app/README.md` documenting:
- Set `.env` Teams vars from Task 0.
- Start a tunnel: `cloudflared tunnel --url http://localhost:3000` (same tool used for GitLab webhooks).
- Set the Azure Bot messaging endpoint to `https://<tunnel-host>/api/messages`.
- `cd apps/server && npx tsc && node dist/index.js` (server runs from `dist/`).
- Zip `manifest.json` + the two PNGs → upload via Teams → Apps → Manage your apps → Upload a custom app.
- DM the bot or `@mention` it in a channel; first message in a channel: `set-channel <slug>`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/teams-app
git commit -m "feat(teams): Teams app manifest, icons, and dev-loop docs"
```

---

## Task 12: Apply migration to the real DB + build

**Files:** none (operational task against `apps/server/agent-hub.db`).

- [ ] **Step 1: Stop the server** (release the SQLite write lock).

- [ ] **Step 2: Apply the migration manually**

From `apps/server` (per repo memory, the real DB is `apps/server/agent-hub.db`):

```bash
cd apps/server && node -e "const db=require('better-sqlite3')('agent-hub.db'); db.exec('ALTER TABLE agents ADD teams_target text'); db.exec('ALTER TABLE runs ADD reply_to text'); console.log('done');"
```

Expected: prints `done`. (If a column already exists it errors `duplicate column name` — safe to ignore per column.)

- [ ] **Step 3: Build and start**

```bash
cd apps/server && npx tsc && node dist/index.js
```

Expected: server starts. With Teams disabled (no `MICROSOFT_APP_ID`) it skips the Teams block; with it enabled, `assertTeamsColumns` passes (columns now exist).

---

## Task 13: Manual end-to-end verification (requires Task 0 credentials)

**Files:** none.

**Blocked by:** Task 0 producing working credentials + sideloading. If blocked, stop here and execute the escalation packet; the entire codebase is complete and unit-tested regardless.

- [ ] **Step 1: Configure + start** — set `.env` Teams vars, tunnel up, Azure messaging endpoint = `https://<tunnel>/api/messages`, server built and running, runner running.
- [ ] **Step 2: Sideload** the zipped app package; confirm the bot appears in Teams.
- [ ] **Step 3: Allowlist self** — put your Entra object ID in `TEAMS_ALLOWED_USER_IDS`, restart server. (Find it via `help` from a non-allowlisted account → should be declined; add the id; retry.)
- [ ] **Step 4: Conversation** — DM the bot `pr-review: <something>`. Expect the 🚀 ack, then (after the runner executes) the result posted in the same thread.
- [ ] **Step 5: Reporting** — in a channel where the bot is added, run `set-channel pr-review`; trigger that agent via a GitLab webhook (or `POST /api/runs`); confirm the result posts to that channel.
- [ ] **Step 6: Access control** — from a non-allowlisted account, message the bot; confirm the "not authorized" decline and that no run is created.
- [ ] **Step 7: Record results** in `apps/server/teams-app/PROVISIONING.md`.

---

## Self-Review Notes

- **Spec coverage:** two-way bot (Tasks 4–9), reporting (Task 8, 10), allowlist (Task 5, 9), per-agent channel via `set-channel` (Tasks 3, 6), addressing by slug (Tasks 3, 4), feature gate (Tasks 1, 9), data model incl. `RunRepository.create` change + migration assertion (Task 2, 9), provisioning spike + fallback (Task 0, 11), error handling (`safeReply`, per-output `.catch`, `onTurnError` — Tasks 6, 8, 9), tests (Tasks 1–9). Agent-to-agent is explicitly out of scope; the `replyTo`/`teamsTarget` reference model leaves room for it.
- **Slug decision:** plan resolves agents via `slugify(name)` rather than the spec's "new column" default, to avoid editing the 9 duplicated in-memory test schemas more than necessary — recorded in Global Constraints.
- **Type consistency:** `processTeamsMessage`/`TeamsTurn`/`TeamsBotDeps` signatures in Task 6 match their use in Task 9's `createTeamsBot`; `TeamsNotifier.post(ref, text)` in Task 7 matches the `TeamsNotifierLike` shape consumed in Task 8; `RunRepository.create({…replyTo})` in Task 2 matches the `runs.create` dep in Task 6.
