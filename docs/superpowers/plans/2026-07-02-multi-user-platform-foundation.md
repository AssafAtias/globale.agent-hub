# Multi-User Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-operator `globale.agent-hub` into a team tool: Entra SSO login, per-user runners that each execute under their own Claude subscription, per-user run routing/visibility, a stale-run reaper, and a Podman-containerized server.

**Architecture:** One shared Fastify+SQLite server (containerized) that every teammate logs into via Microsoft Entra SSO. Each teammate runs the existing polling runner locally with a personal token; the server tags every run with an owner `userId` and `claimNext` hands a run only to its owner's runner. Three auth realms stay separate: session-cookie (humans), `x-runner-token` (runners), webhook secrets (webhooks).

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM + better-sqlite3, TypeBox, `openid-client` (OIDC), `@fastify/secure-session`, Jest + ts-jest, React 18 + Vite (client), Podman.

**Spec:** `docs/superpowers/specs/2026-07-02-multi-user-platform-foundation-design.md`

## Global Constraints

- **Backward compatibility gate:** all new auth behavior is gated by `AUTH_ENABLED` (default `false`). When false, the server behaves exactly as today (open dashboard). Same pattern as the Teams `MICROSOFT_APP_ID` gate.
- **Do not change the runner-token or webhook-secret auth realms.** Only the human-facing surface gets SSO.
- **No null owners after migration:** `agents.ownerId` and `runs.userId` are required in application code; the `0007` migration backfills every existing row to a bootstrap admin.
- **Migrations are journal-aware:** author a Drizzle `.sql` migration (`0007`) and apply via Drizzle's `migrate()`. Never hand-roll an ALTER-differ that diverges from `meta/_journal.json`.
- **Server runs from `dist/`:** after any server change, `npx tsc` in `apps/server` and restart `node dist/index.js` — dev hot-reload is unreliable in this repo.
- **Tests:** ts-jest, `testMatch: **/test/**/*.test.ts`. DB tests use `resetDb()` + `getDb(':memory:')` and create tables via `$client.exec(...)` (see `apps/server/test/migration.test.ts`).
- **Commit style:** conventional commits (`feat:`, `chore:`, `test:`, `docs:`). Commit after each task.
- **Runner cannot be containerized** (needs each human's `~/.claude`). Server only.

## File Structure

**Server — new files**
- `apps/server/src/db/migrations/0007_multiuser.sql` — additive columns + bootstrap-admin backfill.
- `apps/server/src/db/migrate.ts` — journal-aware `runMigrations(url)` called at startup.
- `apps/server/src/services/UserRepository.ts` — user upsert/lookup, bootstrap-admin, role management.
- `apps/server/src/services/RunReaper.ts` — periodic stale-`running` reaper.
- `apps/server/src/services/auth/oidc.ts` — Entra OIDC discovery + auth-URL + code-exchange helpers.
- `apps/server/src/api/plugins/authPlugin.ts` — session decode + `requireUser` / `requireAdmin` guards.
- `apps/server/src/api/routes/auth.ts` — `/auth/login`, `/auth/callback`, `/auth/logout`, `GET /api/me`.
- `apps/server/src/api/routes/users.ts` — admin user list + role change.
- `apps/server/Dockerfile`, `apps/server/.dockerignore`, `compose.yaml` (repo root), `run-runner.ps1` (repo root), `docs/DEPLOY.md`.

**Server — modified files**
- `apps/server/src/db/schema.ts` — add columns to `users`, `runners`, `runs`, `agents`.
- `apps/server/src/config/environment.ts` — new env vars + `authEnabled()` helper.
- `apps/server/src/services/RunRepository.ts` — `create` accepts `userId`; `claimNext(runnerId, runnerUserId)`; `findAllForUser`; `reapStale`.
- `apps/server/src/services/RunnerRepository.ts` — `register(name, token, userId)`; token lookup returns `userId`.
- `apps/server/src/api/routes/runs.ts` — scope split (human vs runner), owner on create, owner filter on read, owner on handoff.
- `apps/server/src/api/routes/webhooks.ts` — owner on the 3 create sites.
- `apps/server/src/api/routes/runners.ts` — bind registered runner to `req.user`.
- `apps/server/src/services/Scheduler.ts` — owner on schedule create.
- `apps/server/src/services/teams/TeamsBot.ts` — resolve `aadObjectId` → owner on create.
- `apps/server/src/app.ts` — register auth plugin by scope; keep `assertTeamsColumns`.
- `apps/server/src/index.ts` — `runMigrations` + `startRunReaper` at startup.

**Client — modified files**
- `apps/client/src/api.ts` (or equivalent fetch wrapper) — on 401 redirect to `/auth/login`.
- `apps/client` app shell — current-user badge + logout; admin-only agent-owner selector + user-roles page.

---

## Task 1: Add multi-user columns to the schema

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/test/schema-multiuser.test.ts`

**Interfaces:**
- Produces: `users.entraObjectId`, `users.name`, `runners.userId`, `runs.userId`, `agents.ownerId` (all `text`, nullable at the column level for SQLite ALTER compatibility).

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/schema-multiuser.test.ts
import { users, runners, runs, agents } from '../src/db/schema.js';

describe('multi-user schema columns', () => {
  it('declares the new columns', () => {
    expect(Object.keys(users)).toEqual(expect.arrayContaining(['entraObjectId', 'name']));
    expect(Object.keys(runners)).toEqual(expect.arrayContaining(['userId']));
    expect(Object.keys(runs)).toEqual(expect.arrayContaining(['userId']));
    expect(Object.keys(agents)).toEqual(expect.arrayContaining(['ownerId']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/schema-multiuser.test.ts`
Expected: FAIL (columns missing).

- [ ] **Step 3: Add the columns**

In `apps/server/src/db/schema.ts`, extend the existing tables (keep all current columns):

```ts
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  entraObjectId: text('entra_object_id'),
  name: text('name'),
});
```

Add to `runners`: `userId: text('user_id'),`
Add to `runs`: `userId: text('user_id'),`
Add to `agents`: `ownerId: text('owner_id'),`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/schema-multiuser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/test/schema-multiuser.test.ts
git commit -m "feat(db): add multi-user columns (users.entra_object_id/name, runners/runs owner, agents.owner_id)"
```

---

## Task 2: Author the `0007` migration + bootstrap-admin backfill

**Files:**
- Create: `apps/server/src/db/migrations/0007_multiuser.sql`
- Test: `apps/server/test/migration-0007.test.ts`

**Interfaces:**
- Produces: an idempotent-by-journal SQL migration that adds the 5 columns and backfills a single bootstrap `admin` user, assigning all existing `runners`/`runs`/`agents` to it.

**Note on generation:** Prefer `cd apps/server && npx drizzle-kit generate --name multiuser` to produce the ALTER statements + update `meta/_journal.json`, then append the backfill block below to the generated `.sql`. If you hand-write the file, you MUST also add its entry to `apps/server/src/db/migrations/meta/_journal.json` (copy the shape of the `0006` entry, incrementing `idx` and using a fixed `when` timestamp) or Drizzle's `migrate()` will not run it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/migration-0007.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb, resetDb } from '../src/db/client.js';

const SQL = readFileSync(join(__dirname, '../src/db/migrations/0007_multiuser.sql'), 'utf8');

function setup() {
  const db = getDb(':memory:');
  const s = (db as any).$client;
  s.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
    CREATE TABLE runners (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline');
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO runners VALUES ('r1','r','h','2026-01-01T00:00:00.000Z','offline');
    INSERT INTO agents VALUES ('a1','A','2026-01-01T00:00:00.000Z');
    INSERT INTO runs VALUES ('run1','a1','done','2026-01-01T00:00:00.000Z');
  `);
  return s;
}

describe('0007 multiuser migration', () => {
  beforeEach(() => { resetDb(); });
  afterAll(() => resetDb());

  it('adds columns and backfills a bootstrap admin as owner of all rows', () => {
    const s = setup();
    s.exec(SQL);
    const admin = s.prepare("SELECT id, role FROM users WHERE role='admin'").get();
    expect(admin).toBeTruthy();
    expect(s.prepare('SELECT user_id FROM runners WHERE id=?').get('r1').user_id).toBe(admin.id);
    expect(s.prepare('SELECT user_id FROM runs WHERE id=?').get('run1').user_id).toBe(admin.id);
    expect(s.prepare('SELECT owner_id FROM agents WHERE id=?').get('a1').owner_id).toBe(admin.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/migration-0007.test.ts`
Expected: FAIL (file not found / columns missing).

- [ ] **Step 3: Write the migration SQL**

```sql
-- apps/server/src/db/migrations/0007_multiuser.sql
ALTER TABLE `users` ADD `entra_object_id` text;
ALTER TABLE `users` ADD `name` text;
ALTER TABLE `runners` ADD `user_id` text;
ALTER TABLE `runs` ADD `user_id` text;
ALTER TABLE `agents` ADD `owner_id` text;

-- Bootstrap admin: created only if there are no users yet.
INSERT INTO `users` (id, email, role, name)
SELECT 'bootstrap-admin', 'bootstrap-admin@local', 'admin', 'Bootstrap Admin'
WHERE NOT EXISTS (SELECT 1 FROM `users`);

-- Backfill ownership on pre-existing rows to the first admin.
UPDATE `runners` SET `user_id` = (SELECT id FROM `users` WHERE role='admin' ORDER BY id LIMIT 1) WHERE `user_id` IS NULL;
UPDATE `runs`    SET `user_id` = (SELECT id FROM `users` WHERE role='admin' ORDER BY id LIMIT 1) WHERE `user_id` IS NULL;
UPDATE `agents`  SET `owner_id` = (SELECT id FROM `users` WHERE role='admin' ORDER BY id LIMIT 1) WHERE `owner_id` IS NULL;
```

Then ensure the journal entry exists (via `drizzle-kit generate` or manual edit of `meta/_journal.json`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/migration-0007.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/migrations/
git commit -m "feat(db): 0007 migration adds multi-user columns + bootstrap-admin backfill"
```

---

## Task 3: Run migrations at startup

**Files:**
- Create: `apps/server/src/db/migrate.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/migrate.test.ts`

**Interfaces:**
- Produces: `runMigrations(url: string): void` — applies all pending Drizzle migrations (journal-aware) to the DB at `url`. Called once at startup before the server listens.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/migrate.test.ts
import { getDb, resetDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

describe('runMigrations', () => {
  beforeEach(() => resetDb());
  afterAll(() => resetDb());

  it('creates the full schema on a fresh in-memory db and is safe to run twice', () => {
    runMigrations(':memory:');
    runMigrations(':memory:'); // idempotent — journal skips applied
    const s = (getDb(':memory:') as any).$client;
    const cols = s.prepare("PRAGMA table_info(agents)").all().map((c: any) => c.name);
    expect(cols).toContain('owner_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/migrate.test.ts`
Expected: FAIL (`runMigrations` not defined).

- [ ] **Step 3: Implement `migrate.ts`**

```ts
// apps/server/src/db/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDb } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Apply all pending Drizzle migrations (journal-aware, idempotent). */
export function runMigrations(url: string): void {
  const db = getDb(url);
  // migrations folder lives next to the compiled db module (src at dev, dist at runtime — see build step)
  migrate(db, { migrationsFolder: join(here, 'migrations') });
}
```

Build note: ensure `apps/server/src/db/migrations/*.sql` + `meta/` are copied into `dist/db/migrations` on build (the migrator reads `.sql` at runtime). If `tsc` doesn't copy them, add a `copyfiles`/`cpx` postbuild or a small script in `package.json` `build`. Verify `dist/db/migrations/_journal.json` exists after build.

- [ ] **Step 4: Wire into startup — modify `apps/server/src/index.ts`**

Add near the top of startup, before `buildApp(...).listen(...)`:

```ts
import { runMigrations } from './db/migrate.js';
// ...after loadConfig():
runMigrations(config.DATABASE_URL);
```

- [ ] **Step 5: Run test + build to verify**

Run: `cd apps/server && npx jest test/migrate.test.ts && npx tsc --noEmit`
Expected: test PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/index.ts apps/server/package.json
git commit -m "feat(db): apply Drizzle migrations at startup (journal-aware, idempotent)"
```

---

## Task 4: Add auth/reaper env vars + `authEnabled()` helper

**Files:**
- Modify: `apps/server/src/config/environment.ts`
- Test: `apps/server/test/environment-auth.test.ts`

**Interfaces:**
- Produces: `Environment` gains `AUTH_ENABLED: boolean`, `ENTRA_TENANT_ID/ENTRA_CLIENT_ID/ENTRA_CLIENT_SECRET: string | undefined`, `SESSION_SECRET: string | undefined`, `PUBLIC_BASE_URL: string | undefined`, `RUN_STALE_TIMEOUT_MS: number`. New export `authEnabled(config): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/environment-auth.test.ts
import { loadConfig, authEnabled } from '../src/config/environment.js';

describe('auth env', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('authEnabled is false by default', () => {
    process.env = { ...OLD, AUTH_ENABLED: undefined, NODE_ENV: 'test' } as any;
    expect(authEnabled(loadConfig())).toBe(false);
  });

  it('authEnabled true parses ENTRA vars and RUN_STALE_TIMEOUT_MS default', () => {
    process.env = { ...OLD, AUTH_ENABLED: 'true', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's', SESSION_SECRET: 'x'.repeat(32), PUBLIC_BASE_URL: 'https://h', NODE_ENV: 'test' } as any;
    const c = loadConfig();
    expect(authEnabled(c)).toBe(true);
    expect(c.RUN_STALE_TIMEOUT_MS).toBe(780000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/environment-auth.test.ts`
Expected: FAIL (`authEnabled` not exported).

- [ ] **Step 3: Extend `environment.ts`**

Add to the `Environment` type:

```ts
  AUTH_ENABLED: boolean;
  ENTRA_TENANT_ID: string | undefined;
  ENTRA_CLIENT_ID: string | undefined;
  ENTRA_CLIENT_SECRET: string | undefined;
  SESSION_SECRET: string | undefined;
  PUBLIC_BASE_URL: string | undefined;
  RUN_STALE_TIMEOUT_MS: number;
```

Add to the `loadConfig()` object literal:

```ts
    AUTH_ENABLED: ['true', '1', 'yes'].includes((process.env.AUTH_ENABLED ?? '').trim().toLowerCase()),
    ENTRA_TENANT_ID: process.env.ENTRA_TENANT_ID,
    ENTRA_CLIENT_ID: process.env.ENTRA_CLIENT_ID,
    ENTRA_CLIENT_SECRET: process.env.ENTRA_CLIENT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    RUN_STALE_TIMEOUT_MS: Number(process.env.RUN_STALE_TIMEOUT_MS ?? 780000),
```

Add the helper (mirrors `teamsEnabled`):

```ts
export function authEnabled(config: Environment): boolean {
  return config.AUTH_ENABLED;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/environment-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config/environment.ts apps/server/test/environment-auth.test.ts
git commit -m "feat(config): add AUTH_ENABLED + ENTRA/session/reaper env vars"
```

---

## Task 5: UserRepository (upsert-by-oid, bootstrap admin, roles)

**Files:**
- Create: `apps/server/src/services/UserRepository.ts`
- Test: `apps/server/test/userRepository.test.ts`

**Interfaces:**
- Produces:
  - `UserRepository.upsertByEntraOid({ entraObjectId, email, name }): UserRow` — inserts if new; the first-ever user gets `role='admin'`, others `'member'`; updates email/name on repeat.
  - `UserRepository.findById(id): UserRow | null`
  - `UserRepository.findAll(): UserRow[]`
  - `UserRepository.setRole(id, role: 'admin' | 'member'): UserRow | null`
  - `type UserRow = typeof users.$inferSelect`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/userRepository.test.ts
import { getDb, resetDb } from '../src/db/client.js';
import { UserRepository } from '../src/services/UserRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      entra_object_id TEXT, name TEXT);
  `);
}

describe('UserRepository', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());

  it('first user becomes admin, second is member', () => {
    const a = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a@x', name: 'A' });
    const b = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-b', email: 'b@x', name: 'B' });
    expect(a.role).toBe('admin');
    expect(b.role).toBe('member');
  });

  it('upsert is idempotent on oid and updates email/name', () => {
    const a1 = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a@x', name: 'A' });
    const a2 = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a2@x', name: 'A2' });
    expect(a2.id).toBe(a1.id);
    expect(a2.email).toBe('a2@x');
    expect(UserRepository.findAll()).toHaveLength(1);
  });

  it('setRole updates role', () => {
    const b = UserRepository.upsertByEntraOid({ entraObjectId: 'oid-a', email: 'a@x', name: 'A' });
    const upd = UserRepository.setRole(b.id, 'member');
    expect(upd?.role).toBe('member');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/userRepository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `UserRepository.ts`**

```ts
// apps/server/src/services/UserRepository.ts
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';

export type UserRow = typeof users.$inferSelect;

export const UserRepository = {
  findById(id: string): UserRow | null {
    return getDb().select().from(users).where(eq(users.id, id)).get() ?? null;
  },
  findByEntraOid(oid: string): UserRow | null {
    return getDb().select().from(users).where(eq(users.entraObjectId, oid)).get() ?? null;
  },
  findAll(): UserRow[] {
    return getDb().select().from(users).all();
  },
  upsertByEntraOid(data: { entraObjectId: string; email: string; name: string }): UserRow {
    const existing = this.findByEntraOid(data.entraObjectId);
    if (existing) {
      getDb().update(users).set({ email: data.email, name: data.name }).where(eq(users.id, existing.id)).run();
      return { ...existing, email: data.email, name: data.name };
    }
    const isFirst = getDb().select().from(users).all().length === 0;
    const row: UserRow = {
      id: randomUUID(),
      email: data.email,
      role: isFirst ? 'admin' : 'member',
      entraObjectId: data.entraObjectId,
      name: data.name,
    };
    getDb().insert(users).values(row).run();
    return row;
  },
  setRole(id: string, role: 'admin' | 'member'): UserRow | null {
    getDb().update(users).set({ role }).where(eq(users.id, id)).run();
    return this.findById(id);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/userRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/UserRepository.ts apps/server/test/userRepository.test.ts
git commit -m "feat(users): UserRepository with bootstrap-admin + upsert-by-oid + roles"
```

---

## Task 6: Owner-aware `RunRepository.create` + `RunnerRepository` userId

**Files:**
- Modify: `apps/server/src/services/RunRepository.ts:15-34`
- Modify: `apps/server/src/services/RunnerRepository.ts:13-27`
- Test: `apps/server/test/run-owner.test.ts`

**Interfaces:**
- Consumes: `users`/`runs`/`runners` columns from Task 1.
- Produces:
  - `RunRepository.create(data: Pick<RunRow,'agentId'|'trigger'|'triggerPayload'|'context'> & { replyTo?: string|null; userId?: string|null }): RunRow`
  - `RunnerRepository.register(name: string, token: string, userId?: string | null)` — persists `userId`.
  - `RunnerRepository.findByToken` returns a row that includes `userId`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/run-owner.test.ts
import { getDb, resetDb } from '../src/db/client.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL,
      runner_id TEXT, result TEXT, error TEXT, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, session_id TEXT,
      pending_gate TEXT, pending_response TEXT, reply_to TEXT, user_id TEXT
    );
  `);
}

describe('RunRepository.create owner', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());

  it('persists userId when provided', () => {
    const r = RunRepository.create({ agentId: 'a1', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u1' });
    expect(r.userId).toBe('u1');
    expect(RunRepository.findById(r.id)?.userId).toBe('u1');
  });

  it('defaults userId to null when omitted', () => {
    const r = RunRepository.create({ agentId: 'a1', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    expect(r.userId ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/run-owner.test.ts`
Expected: FAIL (`user_id` not written / type error).

- [ ] **Step 3: Update `RunRepository.create`**

Change the signature and the row default (`apps/server/src/services/RunRepository.ts:15-31`):

```ts
  create(data: Pick<RunRow, 'agentId' | 'trigger' | 'triggerPayload' | 'context'> & { replyTo?: string | null; userId?: string | null }): RunRow {
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
      userId: null,
      ...data,
    };
    getDb().insert(runs).values(row).run();
    return row;
  },
```

Also add `userId: null` to the `createCompleted` row literal (`RunRepository.ts:38-42`) so the type matches.

- [ ] **Step 4: Update `RunnerRepository.register`**

`apps/server/src/services/RunnerRepository.ts:13-24`:

```ts
  register(name: string, token: string, userId: string | null = null): { runner: RunnerRow; token: string } {
    const id = randomUUID();
    const row: RunnerRow = {
      id,
      name,
      tokenHash: hashToken(token),
      lastSeen: new Date().toISOString(),
      status: 'online',
      userId,
    };
    getDb().insert(runners).values(row).run();
    return { runner: row, token };
  },
```

(`findByToken` already `select()`s all columns, so it returns `userId` automatically.)

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/server && npx jest test/run-owner.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/RunRepository.ts apps/server/src/services/RunnerRepository.ts apps/server/test/run-owner.test.ts
git commit -m "feat(runs): owner userId on run + runner creation"
```

---

## Task 7: User-scoped `claimNext` + owner-filtered reads

**Files:**
- Modify: `apps/server/src/services/RunRepository.ts:50-66` (`claimNext`) and add `findAllForUser`
- Test: `apps/server/test/claimNext-scope.test.ts`

**Interfaces:**
- Consumes: `runs.userId` (Task 1), owner-aware `create` (Task 6).
- Produces:
  - `RunRepository.claimNext(runnerId: string, runnerUserId: string | null): RunRow | null` — claims the oldest pending run whose `userId` equals `runnerUserId`.
  - `RunRepository.findAllForUser(userId: string): RunRow[]` — all runs owned by `userId`, same ordering as `findAll`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/claimNext-scope.test.ts
import { getDb, resetDb } from '../src/db/client.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL,
      runner_id TEXT, result TEXT, error TEXT, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, session_id TEXT,
      pending_gate TEXT, pending_response TEXT, reply_to TEXT, user_id TEXT
    );
  `);
}

describe('claimNext user scoping', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());

  it('a runner only claims runs owned by its user', () => {
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u1' });
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u2' });

    const forU2 = RunRepository.claimNext('runnerB', 'u2');
    expect(forU2?.userId).toBe('u2');

    // u2's only run is now running; a u2 runner finds nothing more
    expect(RunRepository.claimNext('runnerB', 'u2')).toBeNull();
    // u1's run is still claimable by a u1 runner
    expect(RunRepository.claimNext('runnerA', 'u1')?.userId).toBe('u1');
  });

  it('findAllForUser returns only that user\\'s runs', () => {
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u1' });
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u2' });
    expect(RunRepository.findAllForUser('u1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/claimNext-scope.test.ts`
Expected: FAIL (arity/behavior mismatch).

- [ ] **Step 3: Update `claimNext` (keep the `BEGIN IMMEDIATE` transaction)**

`apps/server/src/services/RunRepository.ts:50-66`:

```ts
  claimNext(runnerId: string, runnerUserId: string | null): RunRow | null {
    const startedAt = new Date().toISOString();
    const db = getDb();
    const sqlite = (db as any).$client as import('better-sqlite3').Database;

    const claim = sqlite.transaction(() => {
      const pending = db.select().from(runs)
        .where(and(eq(runs.status, 'pending'), eq(runs.userId, runnerUserId as any)))
        .get();
      if (!pending) return null;
      const capturedResponse = pending.pendingResponse;
      db.update(runs).set({ status: 'running', runnerId, startedAt, pendingResponse: null })
        .where(and(eq(runs.id, pending.id), eq(runs.status, 'pending'))).run();
      const claimed = db.select().from(runs).where(eq(runs.id, pending.id)).get();
      return claimed ? { ...claimed, pendingResponse: capturedResponse } : null;
    });

    return claim() as RunRow | null;
  },
```

Add `findAllForUser` next to `findAll`:

```ts
  findAllForUser(userId: string) {
    return getDb().select().from(runs).where(eq(runs.userId, userId)).orderBy(runs.createdAt).all();
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/server && npx jest test/claimNext-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/RunRepository.ts apps/server/test/claimNext-scope.test.ts
git commit -m "feat(runs): user-scoped claimNext + findAllForUser"
```

---

## Task 8: Wire ownership through all five creation sites + `/next` route

**Files:**
- Modify: `apps/server/src/api/routes/runs.ts` (`/next` passes `runner.userId`; handoff branch sets `userId`)
- Modify: `apps/server/src/api/routes/webhooks.ts` (3 create sites)
- Modify: `apps/server/src/services/Scheduler.ts:14`
- Modify: `apps/server/src/services/teams/TeamsBot.ts:61`
- Test: `apps/server/test/ownership-wiring.test.ts`

**Interfaces:**
- Consumes: owner-aware `create` (Task 6), `claimNext(runnerId, runnerUserId)` (Task 7), `UserRepository.findByEntraOid` (Task 5), `AgentRepository.findById(...).ownerId` (Task 1).
- Produces: helper `ownerForAgent(agentId: string): string | null` in `apps/server/src/services/ownership.ts` returning the agent's `ownerId`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/ownership-wiring.test.ts
import { ownerForAgent } from '../src/services/ownership.js';
import { getDb, resetDb } from '../src/db/client.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, owner_id TEXT);
    INSERT INTO agents VALUES ('a1','A','2026-01-01T00:00:00.000Z','owner-1');
    INSERT INTO agents VALUES ('a2','B','2026-01-01T00:00:00.000Z',NULL);
  `);
}

describe('ownerForAgent', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());
  it('returns the agent owner id or null', () => {
    expect(ownerForAgent('a1')).toBe('owner-1');
    expect(ownerForAgent('a2')).toBeNull();
    expect(ownerForAgent('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/ownership-wiring.test.ts`
Expected: FAIL (`ownership.js` missing).

- [ ] **Step 3: Create the helper**

```ts
// apps/server/src/services/ownership.ts
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { agents } from '../db/schema.js';

/** The user who owns non-manual runs of this agent (its ownerId), or null. */
export function ownerForAgent(agentId: string): string | null {
  const row = getDb().select().from(agents).where(eq(agents.id, agentId)).get();
  return (row?.ownerId as string | undefined) ?? null;
}
```

- [ ] **Step 4: Apply ownership at every non-manual site**

`apps/server/src/services/Scheduler.ts:14` — add `userId`:

```ts
        RunRepository.create({
          agentId: agent.id,
          trigger: 'schedule',
          triggerPayload: '{}',
          context: buildScheduledContext(agent.repos),
          userId: agent.ownerId ?? null,
        });
```

`apps/server/src/api/routes/webhooks.ts` — at each of the 3 `RunRepository.create({...})` calls, add `userId: ownerForAgent(<agentId used in that call>)`. Import `ownerForAgent` at the top. (The agent id is already in scope at each site as the matched agent.)

`apps/server/src/services/teams/TeamsBot.ts:61` — resolve the Entra oid to a user, fall back to agent owner:

```ts
  const owner = turn.aadObjectId
    ? (deps.users?.findByEntraOid(turn.aadObjectId)?.id ?? agent.ownerId ?? null)
    : (agent.ownerId ?? null);
  deps.runs.create({
    agentId: agent.id,
    trigger: 'teams',
    triggerPayload: JSON.stringify({ source: 'teams', aadObjectId: turn.aadObjectId }),
    context: JSON.stringify({ 'User request': cmd.input }),
    replyTo: turn.conversationReference,
    userId: owner,
  });
```

Extend `TeamsBotDeps` with an optional `users?: { findByEntraOid(oid: string): { id: string } | null }` and wire it in `createTeamsBot` (`TeamsBot.ts:90` area):

```ts
    users: { findByEntraOid: (oid) => UserRepository.findByEntraOid(oid) },
```

(import `UserRepository`). `agent` here is the `AgentRepository.findBySlug` result, which now includes `ownerId`.

`apps/server/src/api/routes/runs.ts` handoff branch (`runs.ts:174` area) — the spawned child run should inherit the parent agent's owner. Set `userId: ownerForAgent(targetAgentId)` on that `RunRepository.create`.

`apps/server/src/api/routes/runs.ts` `/next` route (`runs.ts:36`) — pass the runner's user:

```ts
        const run = RunRepository.claimNext(runner.id, runner.userId ?? null);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/server && npx jest test/ownership-wiring.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/ownership.ts apps/server/src/services/Scheduler.ts apps/server/src/api/routes/webhooks.ts apps/server/src/services/teams/TeamsBot.ts apps/server/src/api/routes/runs.ts apps/server/test/ownership-wiring.test.ts
git commit -m "feat(runs): assign owner on schedule/webhook/teams/handoff runs + scope /next"
```

---

## Task 9: Stale-run reaper

**Files:**
- Create: `apps/server/src/services/RunReaper.ts`
- Modify: `apps/server/src/services/RunRepository.ts` (add `reapStale`)
- Modify: `apps/server/src/index.ts` (start it, unless `NODE_ENV=test`)
- Test: `apps/server/test/runReaper.test.ts`

**Interfaces:**
- Produces:
  - `RunRepository.reapStale(olderThanMs: number, now: Date): number` — force-fails every `running` run whose `startedAt` is older than `olderThanMs`; returns count.
  - `startRunReaper(intervalMs, staleMs): () => void` — periodic tick (runs once immediately); returns a stop fn.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/runReaper.test.ts
import { getDb, resetDb } from '../src/db/client.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL,
      runner_id TEXT, result TEXT, error TEXT, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, session_id TEXT,
      pending_gate TEXT, pending_response TEXT, reply_to TEXT, user_id TEXT
    );
  `);
  return (db as any).$client;
}

describe('reapStale', () => {
  beforeEach(() => { resetDb(); });
  afterAll(() => resetDb());

  it('fails running runs older than the timeout, leaves fresh ones', () => {
    const s = setup();
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const now = new Date('2026-01-01T00:20:00.000Z'); // +20min
    s.prepare(`INSERT INTO runs (id,agent_id,trigger,trigger_payload,context,status,started_at,created_at)
               VALUES ('r-old','a','manual','{}','{}','running',?,?)`).run(old, old);
    s.prepare(`INSERT INTO runs (id,agent_id,trigger,trigger_payload,context,status,started_at,created_at)
               VALUES ('r-new','a','manual','{}','{}','running',?,?)`).run(now.toISOString(), old);

    const n = RunRepository.reapStale(780000, now); // 13min
    expect(n).toBe(1);
    expect(RunRepository.findById('r-old')?.status).toBe('failed');
    expect(RunRepository.findById('r-new')?.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/runReaper.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `reapStale` to `RunRepository`**

```ts
  reapStale(olderThanMs: number, now: Date): number {
    const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
    const stale = getDb().select().from(runs)
      .where(and(eq(runs.status, 'running'), lt(runs.startedAt, cutoff))).all();
    for (const r of stale) {
      getDb().update(runs).set({
        status: 'failed',
        error: 'Run watchdog: exceeded stale timeout with no result (runner presumed dead).',
        finishedAt: now.toISOString(),
      }).where(eq(runs.id, r.id)).run();
    }
    return stale.length;
  },
```

Add `lt` to the drizzle import at the top of `RunRepository.ts`: `import { eq, and, desc, lt } from 'drizzle-orm';`

- [ ] **Step 4: Implement `RunReaper.ts`**

```ts
// apps/server/src/services/RunReaper.ts
import { RunRepository } from './RunRepository.js';

/** Periodically force-fail runs stuck in 'running'. Runs once immediately. Returns a stop fn. */
export function startRunReaper(intervalMs = 60_000, staleMs = 780_000): () => void {
  const tick = () => {
    try {
      const n = RunRepository.reapStale(staleMs, new Date());
      if (n > 0) console.error(`[RunReaper] force-failed ${n} stale run(s)`);
    } catch (e) { console.error('[RunReaper] tick failed:', e); }
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
```

- [ ] **Step 5: Start it at startup — modify `apps/server/src/index.ts`**

After the server starts listening, guard on test env:

```ts
import { startRunReaper } from './services/RunReaper.js';
// ...after listen:
if (process.env.NODE_ENV !== 'test') {
  startRunReaper(60_000, config.RUN_STALE_TIMEOUT_MS);
}
```

- [ ] **Step 6: Run test + typecheck**

Run: `cd apps/server && npx jest test/runReaper.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/RunReaper.ts apps/server/src/services/RunRepository.ts apps/server/src/index.ts apps/server/test/runReaper.test.ts
git commit -m "feat(runs): stale-run reaper force-fails dead-runner runs"
```

---

## Task 10: OIDC helpers (Entra discovery + auth URL + code exchange)

**Files:**
- Create: `apps/server/src/services/auth/oidc.ts`
- Modify: `apps/server/package.json` (add `openid-client`)
- Test: `apps/server/test/oidc.test.ts`

**Interfaces:**
- Produces:
  - `type OidcConfig` (opaque handle from `openid-client`).
  - `getOidc(config: Environment): Promise<OidcConfig>` — memoized discovery against `https://login.microsoftonline.com/{tenant}/v2.0`.
  - `buildLoginUrl(oidc, { redirectUri, state, nonce, codeVerifier }): string`
  - `exchangeCode(oidc, { currentUrl, redirectUri, state, nonce, codeVerifier }): Promise<{ entraObjectId: string; email: string; name: string }>` — validates the id_token and returns claims (`oid`, `email`/`preferred_username`, `name`).

**Library note:** target `openid-client@^6`. Confirm the exact v6 surface (`discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `randomState`, `randomNonce`) against the installed version's docs before finalizing — the code below is written to v6.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/server && npm install openid-client@^6`
Expected: `openid-client` appears in `dependencies`.

- [ ] **Step 2: Write the failing test** (pure helper: claim extraction)

```ts
// apps/server/test/oidc.test.ts
import { extractClaims } from '../src/services/auth/oidc.js';

describe('extractClaims', () => {
  it('maps oid/email/name from id_token claims', () => {
    const c = extractClaims({ oid: 'OID', email: 'e@x', name: 'N' } as any);
    expect(c).toEqual({ entraObjectId: 'OID', email: 'e@x', name: 'N' });
  });
  it('falls back to preferred_username and sub', () => {
    const c = extractClaims({ sub: 'S', preferred_username: 'p@x' } as any);
    expect(c.entraObjectId).toBe('S');
    expect(c.email).toBe('p@x');
    expect(c.name).toBe('p@x');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && npx jest test/oidc.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `oidc.ts`**

```ts
// apps/server/src/services/auth/oidc.ts
import * as client from 'openid-client';
import type { Environment } from '../../config/environment.js';

export type OidcConfig = client.Configuration;

export interface Claims { entraObjectId: string; email: string; name: string; }

/** Pure: derive our user fields from id_token claims. */
export function extractClaims(claims: Record<string, unknown>): Claims {
  const entraObjectId = String(claims.oid ?? claims.sub);
  const email = String(claims.email ?? claims.preferred_username ?? '');
  const name = String(claims.name ?? claims.preferred_username ?? email);
  return { entraObjectId, email, name };
}

let _cfg: Promise<OidcConfig> | null = null;
export function getOidc(env: Environment): Promise<OidcConfig> {
  if (!_cfg) {
    const issuer = new URL(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`);
    _cfg = client.discovery(issuer, env.ENTRA_CLIENT_ID!, env.ENTRA_CLIENT_SECRET!);
  }
  return _cfg;
}

export function buildLoginUrl(oidc: OidcConfig, p: { redirectUri: string; state: string; nonce: string; codeChallenge: string; }): string {
  return client.buildAuthorizationUrl(oidc, {
    redirect_uri: p.redirectUri,
    scope: 'openid profile email',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
  }).href;
}

export async function exchangeCode(oidc: OidcConfig, p: { currentUrl: string; state: string; nonce: string; codeVerifier: string; }): Promise<Claims> {
  const tokens = await client.authorizationCodeGrant(oidc, new URL(p.currentUrl), {
    expectedState: p.state,
    expectedNonce: p.nonce,
    pkceCodeVerifier: p.codeVerifier,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('No id_token claims');
  return extractClaims(claims as Record<string, unknown>);
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/server && npx jest test/oidc.test.ts && npx tsc --noEmit`
Expected: PASS + clean. (If v6 API names differ, adjust per docs and re-run.)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/auth/oidc.ts apps/server/package.json apps/server/package-lock.json apps/server/test/oidc.test.ts
git commit -m "feat(auth): Entra OIDC discovery + auth-url + code-exchange helpers"
```

---

## Task 11: Auth plugin (session + `requireUser`/`requireAdmin`)

**Files:**
- Create: `apps/server/src/api/plugins/authPlugin.ts`
- Modify: `apps/server/package.json` (add `@fastify/secure-session`)
- Test: `apps/server/test/authPlugin.test.ts`

**Interfaces:**
- Consumes: `Environment` (Task 4), `UserRepository.findById` (Task 5).
- Produces:
  - Fastify decorators: `request.user: UserRow | null`, `reply` helpers not needed.
  - `registerAuth(app, config)` — registers `@fastify/secure-session` and a `preHandler` that loads `request.user` from the session cookie (`userId`).
  - `requireUser` / `requireAdmin` — `preHandler` guards: 401 if no user, 403 if not admin. When `AUTH_ENABLED=false`, guards resolve to a synthetic admin (`request.user = { id: 'bootstrap-admin', role: 'admin' }` if present, else a passthrough) so existing open-mode behavior is preserved.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/server && npm install @fastify/secure-session@^8`

- [ ] **Step 2: Write the failing test**

```ts
// apps/server/test/authPlugin.test.ts
import Fastify from 'fastify';
import { requireUser, requireAdmin } from '../src/api/plugins/authPlugin.js';

describe('auth guards', () => {
  it('requireUser 401s when no user is attached', async () => {
    const app = Fastify();
    app.get('/x', { preHandler: requireUser }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('requireAdmin 403s for a member', async () => {
    const app = Fastify();
    app.addHook('preHandler', async (req) => { (req as any).user = { id: 'u', role: 'member' }; });
    app.get('/x', { preHandler: requireAdmin }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/server && npx jest test/authPlugin.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `authPlugin.ts`**

```ts
// apps/server/src/api/plugins/authPlugin.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import secureSession from '@fastify/secure-session';
import type { Environment } from '../../config/environment.js';
import { authEnabled } from '../../config/environment.js';
import { UserRepository, type UserRow } from '../../services/UserRepository.js';

declare module 'fastify' {
  interface FastifyRequest { user: UserRow | null; }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.status(401).send({ error: 'Authentication required' });
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.status(401).send({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Admin only' });
}

/** Register the session store + a preHandler that loads request.user. */
export async function registerAuth(app: FastifyInstance, config: Environment) {
  app.decorateRequest('user', null);

  if (!authEnabled(config)) {
    // Open mode: attach the bootstrap admin (if present) so admin routes work as before.
    app.addHook('preHandler', async (req) => {
      req.user = UserRepository.findById('bootstrap-admin') ?? { id: 'bootstrap-admin', email: '', role: 'admin', entraObjectId: null, name: 'Bootstrap Admin' } as UserRow;
    });
    return;
  }

  await app.register(secureSession, {
    key: Buffer.from(config.SESSION_SECRET!.padEnd(32, '0').slice(0, 32)),
    cookieName: 'agenthub_session',
    cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: true },
  });

  app.addHook('preHandler', async (req) => {
    const uid = req.session.get('userId') as string | undefined;
    req.user = uid ? UserRepository.findById(uid) : null;
  });
}
```

**Note:** `@fastify/secure-session` needs a 32-byte key; the `padEnd/slice` is a pragmatic derivation from `SESSION_SECRET`. For production prefer a base64 32-byte key via `secret`/`salt` per the plugin docs — confirm and adjust.

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/server && npx jest test/authPlugin.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/api/plugins/authPlugin.ts apps/server/package.json apps/server/package-lock.json apps/server/test/authPlugin.test.ts
git commit -m "feat(auth): session plugin + requireUser/requireAdmin guards (open-mode passthrough)"
```

---

## Task 12: Auth routes (`/auth/login`, `/auth/callback`, `/auth/logout`, `GET /api/me`)

**Files:**
- Create: `apps/server/src/api/routes/auth.ts`
- Modify: `apps/server/src/app.ts` (register auth plugin + routes)
- Test: `apps/server/test/me-route.test.ts`

**Interfaces:**
- Consumes: `getOidc`/`buildLoginUrl`/`exchangeCode` (Task 10), `UserRepository.upsertByEntraOid` (Task 5), session (Task 11).
- Produces: `buildAuthRoutes(config): FastifyPluginAsyncTypebox` exposing:
  - `GET /auth/login` → 302 to Entra (stores `state`/`nonce`/`codeVerifier` in session).
  - `GET /auth/callback` → exchanges code, upserts user, sets `session.userId`, 302 to `/`.
  - `POST /auth/logout` → clears session, 204.
  - `GET /api/me` → `{ id, email, name, role }` (401 if unauthenticated).

- [ ] **Step 1: Write the failing test** (`/api/me` shape via a stubbed user)

```ts
// apps/server/test/me-route.test.ts
import Fastify from 'fastify';
import { buildAuthRoutes } from '../src/api/routes/auth.js';
import { loadConfig } from '../src/config/environment.js';

describe('GET /api/me', () => {
  it('returns the attached user, else 401', async () => {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = req.headers['x-test-user'] ? { id: 'u', email: 'e@x', name: 'N', role: 'member' } : null;
    });
    await app.register(buildAuthRoutes(loadConfig()));
    const anon = await app.inject({ method: 'GET', url: '/api/me' });
    expect(anon.statusCode).toBe(401);
    const authed = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-test-user': '1' } });
    expect(authed.json()).toMatchObject({ id: 'u', role: 'member' });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/me-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `auth.ts`**

```ts
// apps/server/src/api/routes/auth.ts
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import * as client from 'openid-client';
import type { Environment } from '../../config/environment.js';
import { authEnabled } from '../../config/environment.js';
import { getOidc, buildLoginUrl, exchangeCode } from '../../services/auth/oidc.js';
import { UserRepository } from '../../services/UserRepository.js';

export function buildAuthRoutes(config: Environment): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/api/me', async (req, reply) => {
      if (!req.user) return reply.status(401).send({ error: 'Authentication required' });
      const { id, email, name, role } = req.user;
      return { id, email, name, role };
    });

    if (!authEnabled(config)) return; // no SSO endpoints in open mode

    const redirectUri = `${config.PUBLIC_BASE_URL}/auth/callback`;

    app.get('/auth/login', async (req, reply) => {
      const oidc = await getOidc(config);
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      req.session.set('oidc', { state, nonce, codeVerifier });
      return reply.redirect(buildLoginUrl(oidc, { redirectUri, state, nonce, codeChallenge }));
    });

    app.get('/auth/callback', async (req, reply) => {
      const oidc = await getOidc(config);
      const saved = req.session.get('oidc') as { state: string; nonce: string; codeVerifier: string } | undefined;
      if (!saved) return reply.status(400).send({ error: 'No login in progress' });
      const currentUrl = `${config.PUBLIC_BASE_URL}${req.url}`;
      const claims = await exchangeCode(oidc, { currentUrl, ...saved });
      const user = UserRepository.upsertByEntraOid(claims);
      req.session.set('userId', user.id);
      req.session.set('oidc', undefined);
      return reply.redirect('/');
    });

    app.post('/auth/logout', async (req, reply) => {
      req.session.delete();
      return reply.status(204).send();
    });
  };
}
```

- [ ] **Step 4: Register in `app.ts`**

In `buildApp`, before the other route registrations, register auth so `request.user` is populated everywhere:

```ts
import { registerAuth } from './api/plugins/authPlugin.js';
import { buildAuthRoutes } from './api/routes/auth.js';
// ...inside buildApp, after creating `app` and before app.register(agentsRoutes):
await app.register(async (scope) => {
  await registerAuth(scope, config);
  await scope.register(buildAuthRoutes(config));
  // human routes that must be authenticated go INSIDE this scope (Task 13)
});
```

**Important (scope split, Task 13 completes it):** runner endpoints (`/api/runs/next`, `/result`, `/events`) and webhooks must stay OUTSIDE this authenticated scope. For this task, keep all existing `app.register(...)` calls as-is (open mode default keeps them working); Task 13 moves the human run endpoints inside.

`buildApp` must become `async` (it now `await`s registration). Update `index.ts` accordingly (`const app = await buildApp(config)`), and any test that calls `buildApp`.

- [ ] **Step 5: Run test + typecheck + full server test suite**

Run: `cd apps/server && npx jest test/me-route.test.ts && npx tsc --noEmit && npx jest`
Expected: target test PASS; typecheck clean; suite green (fix any `buildApp` await fallout).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/api/routes/auth.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/test/me-route.test.ts
git commit -m "feat(auth): login/callback/logout + /api/me; async buildApp with auth scope"
```

---

## Task 13: Scope split + owner-filtered run reads + manual-run owner

**Files:**
- Modify: `apps/server/src/api/routes/runs.ts` (`buildRunsRoutes` split; `GET /api/runs` filter; `POST /api/runs` owner)
- Modify: `apps/server/src/app.ts` (register human vs runner scopes)
- Test: `apps/server/test/runs-visibility.test.ts`

**Interfaces:**
- Consumes: `requireUser` (Task 11), `findAllForUser` (Task 7), owner-aware `create` (Task 6).
- Produces: `GET /api/runs` returns `findAllForUser(req.user.id)` for members, `findAll()` for admins; `POST /api/runs` sets `userId: req.user.id`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/runs-visibility.test.ts
import Fastify from 'fastify';
import { getDb, resetDb } from '../src/db/client.js';
import { RunRepository } from '../src/services/RunRepository.js';
import { buildHumanRunsRoutes } from '../src/api/routes/runs.js';
import { loadConfig } from '../src/config/environment.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL,
      runner_id TEXT, result TEXT, error TEXT, started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, session_id TEXT,
      pending_gate TEXT, pending_response TEXT, reply_to TEXT, user_id TEXT
    );
  `);
}

async function appAs(user: any) {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => { (req as any).user = user; });
  await app.register(buildHumanRunsRoutes(loadConfig(), undefined));
  return app;
}

describe('GET /api/runs visibility', () => {
  beforeEach(() => { resetDb(); setup();
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u1' });
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u2' });
  });
  afterAll(() => resetDb());

  it('member sees only own runs; admin sees all', async () => {
    const member = await appAs({ id: 'u1', role: 'member' });
    expect((await member.inject({ method: 'GET', url: '/api/runs' })).json()).toHaveLength(1);
    await member.close();
    const admin = await appAs({ id: 'x', role: 'admin' });
    expect((await admin.inject({ method: 'GET', url: '/api/runs' })).json()).toHaveLength(2);
    await admin.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/runs-visibility.test.ts`
Expected: FAIL (`buildHumanRunsRoutes` not exported).

- [ ] **Step 3: Split `buildRunsRoutes` into human + runner plugins**

Refactor `apps/server/src/api/routes/runs.ts` so it exports two plugins:

- `buildRunnerRunsRoutes(...)` — the token-authed endpoints: `GET /api/runs/next`, `POST /api/runs/:id/result`, `POST /api/runs/:id/events` (unchanged bodies; `/next` already passes `runner.userId` from Task 8).
- `buildHumanRunsRoutes(config, teamsNotifier)` — the human endpoints: `GET /api/runs`, `GET /api/runs/:id`, `PATCH /api/runs/:id`, `POST /api/runs`, `POST /api/runs/:id/respond`. Each gets `preHandler: requireUser`.

In `GET /api/runs`:

```ts
    app.get('/api/runs', { preHandler: requireUser, schema: { response: { 200: Type.Array(Type.Any()) } } },
      async (req) => req.user!.role === 'admin' ? RunRepository.findAll() : RunRepository.findAllForUser(req.user!.id)
    );
```

In `POST /api/runs`, set the owner on both `create` calls:

```ts
      // ticket-to-code branch:
        return reply.status(201).send(RunRepository.create({
          agentId: agent.id, trigger: 'manual',
          triggerPayload: JSON.stringify({ issue: { key: ctx.ticket!.key } }),
          context: fetcher.serializeForRunner(ctx),
          userId: req.user!.id,
        }));
      // default branch:
      const run = RunRepository.create({
        agentId: req.body.agentId, trigger: 'manual', triggerPayload: '{}', context: '{}',
        userId: req.user!.id,
      });
```

Import `requireUser` from `../plugins/authPlugin.js`. Keep `GET /api/runs/:id` and `PATCH` guarded by `requireUser`; for `GET /api/runs/:id` additionally 404/403 if a member requests a run they don't own:

```ts
    app.get('/api/runs/:id', { preHandler: requireUser, schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } } },
      async (req, reply) => {
        const run = RunRepository.findById(req.params.id);
        if (!run) return reply.status(404).send({ error: 'Not found' });
        if (req.user!.role !== 'admin' && run.userId !== req.user!.id) return reply.status(404).send({ error: 'Not found' });
        return run;
      });
```

- [ ] **Step 4: Register both scopes in `app.ts`**

Replace the single `app.register(buildRunsRoutes(...))` with:

```ts
  // Runner + webhook realms: token-authed, OUTSIDE the session scope
  app.register(buildRunnerRunsRoutes(config));
  app.register(buildWebhooksRoutes(config));

  // Human realm: session-authed
  await app.register(async (scope) => {
    await registerAuth(scope, config);
    await scope.register(buildAuthRoutes(config));
    await scope.register(buildHumanRunsRoutes(config, teamsNotifier));
    await scope.register(agentsRoutes);        // agent reads shared; writes guarded in Task 14
    await scope.register(runnersRoutes);
    await scope.register(buildSkillsRoutes(config.SKILLS_DIR));
    await scope.register(buildIntegrationsRoutes(config));
    await scope.register(buildDevToolsRoutes(config));
  });
```

(Remove the now-superseded standalone registrations of those routes. `registerAuth` runs first inside the scope so `request.user` is set for all human routes.)

- [ ] **Step 5: Run target test + full suite + typecheck**

Run: `cd apps/server && npx jest test/runs-visibility.test.ts && npx tsc --noEmit && npx jest`
Expected: PASS; clean; suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/api/routes/runs.ts apps/server/src/app.ts apps/server/test/runs-visibility.test.ts
git commit -m "feat(runs): split human/runner route scopes; owner-filtered reads + manual-run owner"
```

---

## Task 14: Admin user management + agent-owner guards

**Files:**
- Create: `apps/server/src/api/routes/users.ts`
- Modify: `apps/server/src/api/routes/agents.ts` (guard writes with `requireAdmin`; accept `ownerId` on create/update)
- Modify: `apps/server/src/app.ts` (register users routes in the human scope)
- Test: `apps/server/test/users-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (Task 11), `UserRepository` (Task 5).
- Produces:
  - `GET /api/users` (admin) → user list.
  - `PATCH /api/users/:id` (admin) `{ role }` → updated user.
  - agents create/update accept optional `ownerId`; when omitted on create, default to `req.user.id`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/test/users-route.test.ts
import Fastify from 'fastify';
import { getDb, resetDb } from '../src/db/client.js';
import { UserRepository } from '../src/services/UserRepository.js';
import { buildUsersRoutes } from '../src/api/routes/users.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', entra_object_id TEXT, name TEXT);`);
}
async function appAs(user: any) {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => { (req as any).user = user; });
  await app.register(buildUsersRoutes());
  return app;
}

describe('users routes', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());

  it('member is forbidden; admin lists + sets role', async () => {
    const u = UserRepository.upsertByEntraOid({ entraObjectId: 'o1', email: 'a@x', name: 'A' }); // admin (first)
    const member = await appAs({ id: 'm', role: 'member' });
    expect((await member.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(403);
    await member.close();
    const admin = await appAs({ id: u.id, role: 'admin' });
    expect((await admin.inject({ method: 'GET', url: '/api/users' })).json()).toHaveLength(1);
    const patched = await admin.inject({ method: 'PATCH', url: `/api/users/${u.id}`, payload: { role: 'member' } });
    expect(patched.json().role).toBe('member');
    await admin.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && npx jest test/users-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `users.ts`**

```ts
// apps/server/src/api/routes/users.ts
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin } from '../plugins/authPlugin.js';
import { UserRepository } from '../../services/UserRepository.js';

export function buildUsersRoutes(): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/api/users', { preHandler: requireAdmin }, async () => UserRepository.findAll());
    app.patch('/api/users/:id', {
      preHandler: requireAdmin,
      schema: { params: Type.Object({ id: Type.String() }), body: Type.Object({ role: Type.Union([Type.Literal('admin'), Type.Literal('member')]) }) },
    }, async (req, reply) => {
      const updated = UserRepository.setRole(req.params.id, req.body.role);
      if (!updated) return reply.status(404).send({ error: 'Not found' });
      return updated;
    });
  };
}
```

- [ ] **Step 4: Guard agent writes + accept `ownerId`**

In `apps/server/src/api/routes/agents.ts`: add `preHandler: requireAdmin` to POST/PATCH/DELETE (create/update/archive/reorder) routes; keep `GET` unguarded (shared roster, already inside the authenticated scope so `requireUser` is implied by the scope's preHandler in Task 13). Add optional `ownerId: Type.Optional(Type.String())` to the create/update body schema and pass it through to the repository; on create, default `ownerId` to `req.user.id` when omitted. (Follow the existing AgentRepository create/update signature — add an `ownerId` field mirroring how `title`/`bio` are handled.)

- [ ] **Step 5: Register in `app.ts`** (inside the human scope from Task 13)

```ts
    await scope.register(buildUsersRoutes());
```

- [ ] **Step 6: Run target test + full suite + typecheck**

Run: `cd apps/server && npx jest test/users-route.test.ts && npx tsc --noEmit && npx jest`
Expected: PASS; clean; green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/api/routes/users.ts apps/server/src/api/routes/agents.ts apps/server/src/app.ts apps/server/test/users-route.test.ts
git commit -m "feat(admin): user management routes + admin-guarded agent writes with ownerId"
```

---

## Task 15: Containerize the server (Dockerfile + compose + volume)

**Files:**
- Create: `apps/server/Dockerfile`, `apps/server/.dockerignore`, `compose.yaml` (repo root)
- Test: manual build + health check (no unit test).

**Interfaces:**
- Produces: an image that runs `node dist/index.js`, applies migrations at startup against a persisted DB volume, and answers `GET /health`.

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
dist
*.db
*.db-wal
*.db-shm
.env
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
# apps/server/Dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY apps/server/package.json apps/server/package-lock.json* ./apps/server/
COPY package.json package-lock.json* ./
RUN cd apps/server && npm install
COPY apps/server ./apps/server
RUN cd apps/server && npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app/apps/server
ENV NODE_ENV=production
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json
# migrations must be present at runtime for the migrator
COPY --from=build /app/apps/server/dist/db/migrations ./dist/db/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

(If the build step does not emit `dist/db/migrations`, add a `postbuild` copy in `package.json` — see Task 3 build note — so the `COPY` line has a source.)

- [ ] **Step 3: Write `compose.yaml`**

```yaml
# compose.yaml (repo root)
services:
  agent-hub-server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      DATABASE_URL: "/data/agent-hub.db"
      AUTH_ENABLED: "${AUTH_ENABLED:-false}"
      ENTRA_TENANT_ID: "${ENTRA_TENANT_ID:-}"
      ENTRA_CLIENT_ID: "${ENTRA_CLIENT_ID:-}"
      ENTRA_CLIENT_SECRET: "${ENTRA_CLIENT_SECRET:-}"
      SESSION_SECRET: "${SESSION_SECRET:-}"
      PUBLIC_BASE_URL: "${PUBLIC_BASE_URL:-}"
      GITLAB_WEBHOOK_SECRET: "${GITLAB_WEBHOOK_SECRET:-}"
    volumes:
      - agent-hub-data:/data
    restart: unless-stopped
volumes:
  agent-hub-data:
```

- [ ] **Step 4: Build + run + verify health and DB persistence**

Run:
```bash
podman compose build
podman compose up -d
curl -s http://localhost:3000/health   # expect {"status":"ok"}
podman compose restart agent-hub-server
curl -s http://localhost:3000/health   # still ok; /data/agent-hub.db persisted via volume
```
Expected: `{"status":"ok"}` both times; server log shows migrations applied once, skipped on restart.

- [ ] **Step 5: Commit**

```bash
git add apps/server/Dockerfile apps/server/.dockerignore compose.yaml
git commit -m "feat(deploy): containerize server for Podman with persisted DB volume"
```

---

## Task 16: Runner setup script + deploy runbook

**Files:**
- Create: `run-runner.ps1` (repo root), `docs/DEPLOY.md`
- Test: manual (documentation + script smoke).

**Interfaces:**
- Produces: a one-command local runner launcher and a runbook covering Entra app registration, TLS, per-user runner tokens, and the `AUTH_ENABLED` flip.

- [ ] **Step 1: Write `run-runner.ps1`**

```powershell
# run-runner.ps1 — start a personal runner against the shared server.
# Usage: .\run-runner.ps1 -ServerUrl https://agent-hub.internal -Token <your-runner-token>
param(
  [Parameter(Mandatory=$true)][string]$ServerUrl,
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$RunnerName = $env:COMPUTERNAME
)
$env:ORCHESTRATOR_URL = $ServerUrl
$env:RUNNER_TOKEN = $Token
$env:RUNNER_NAME = $RunnerName
Write-Host "Building runner…"
Push-Location "$PSScriptRoot/packages/runner"; npx tsc; Pop-Location
Write-Host "Starting runner as '$RunnerName' against $ServerUrl (uses your ~/.claude login)…"
node "$PSScriptRoot/packages/runner/dist/index.js"
```

- [ ] **Step 2: Write `docs/DEPLOY.md`**

Cover, as concrete steps: (1) Entra app registration — single-tenant, redirect URI = `${PUBLIC_BASE_URL}/auth/callback`, client secret; note it may reuse the Teams-bot app. (2) TLS is required (Secure cookie); terminate TLS at the host or a reverse proxy; `PUBLIC_BASE_URL` must be the exact external HTTPS URL. (3) First login becomes admin. (4) Each teammate: register a runner from the dashboard → copy the one-time token → `run-runner.ps1 -ServerUrl … -Token …` on their own machine with a logged-in Claude Code (`~/.claude`). (5) Set an agent's owner (admin) so its webhook/cron runs route to that person's runner. (6) Flip `AUTH_ENABLED=true` once Entra + TLS are ready; before that the dashboard is open (single-operator behavior).

- [ ] **Step 3: Smoke-check the script parses**

Run: `pwsh -NoProfile -Command "Get-Command -Syntax .\run-runner.ps1"`
Expected: prints the parameter syntax with no parse error.

- [ ] **Step 4: Commit**

```bash
git add run-runner.ps1 docs/DEPLOY.md
git commit -m "docs(deploy): per-user runner launcher + Entra/TLS runbook"
```

---

## Task 17: Client — redirect to login on 401 + current-user badge

**Files:**
- Modify: the client's fetch wrapper (search `apps/client/src` for the module that wraps `fetch`/axios; likely `apps/client/src/api.ts` or a `lib/http.ts`).
- Modify: the app shell/header component.
- Test: manual in-browser (client has no jest here) — verify the flow.

**Interfaces:**
- Consumes: `GET /api/me`, `/auth/login`, `POST /auth/logout` (Task 12).
- Produces: on any API `401`, the client redirects `window.location.href = '/auth/login'`; the header shows `me.name` + a Logout button.

- [ ] **Step 1: Add 401 handling in the fetch wrapper**

In the shared request helper, after receiving a response:

```ts
if (res.status === 401) {
  window.location.href = '/auth/login';
  throw new Error('Not authenticated');
}
```

- [ ] **Step 2: Fetch `/api/me` on app load + render badge**

In the app shell, on mount call `GET /api/me`; store `{ name, role }`. Render `me.name` and a Logout button that does `await fetch('/auth/logout', { method: 'POST' }); window.location.href = '/'`. Gate any admin-only nav (users page, agent owner selector) on `me.role === 'admin'`.

- [ ] **Step 3: Build the client**

Run: `cd apps/client && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verify** (with `AUTH_ENABLED=true` server + Entra)

Load the dashboard unauthenticated → redirected to Entra → back to `/` → header shows your name. Logout → next API call redirects to login.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src
git commit -m "feat(client): redirect to SSO on 401 + current-user badge/logout"
```

---

## Task 18: Client — admin agent-owner selector + users page

**Files:**
- Modify: the agent create/edit form component (add owner selector).
- Create: a Users admin page component + route.
- Test: manual in-browser.

**Interfaces:**
- Consumes: `GET /api/users`, `PATCH /api/users/:id` (Task 14), agent create/update `ownerId` (Task 14).
- Produces: admins can set an agent's owner and change user roles; members don't see these controls.

- [ ] **Step 1: Owner selector on the agent form (admin only)**

Fetch `GET /api/users`; render a `<select>` bound to `ownerId` in the agent form; include it in the create/update payload. Show only when `me.role === 'admin'`.

- [ ] **Step 2: Users admin page**

A page listing `GET /api/users` (name, email, role) with a role toggle calling `PATCH /api/users/:id`. Route guarded in nav by `me.role === 'admin'`.

- [ ] **Step 3: Build the client**

Run: `cd apps/client && npm run build`
Expected: success.

- [ ] **Step 4: Manual verify**

As admin: set agent owner to teammate B; trigger the agent's webhook → the run is owned by B and only B's runner claims it. As member: the owner selector and users page are absent.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src
git commit -m "feat(client): admin agent-owner selector + users management page"
```

---

## Task 19: End-to-end verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full server suite + typecheck**

Run: `cd apps/server && npx tsc --noEmit && npx jest`
Expected: all green.

- [ ] **Step 2: Open-mode regression (AUTH_ENABLED unset)**

Boot the server without auth vars; confirm the dashboard works as before, a manual run is created and claimed by a legacy runner (bootstrap-admin owner), and no auth redirects occur.

- [ ] **Step 3: Auth-mode happy path (AUTH_ENABLED=true)**

With Entra + TLS: first login → admin; second user → member; member sees only own runs; admin sees all; a member's manual run is claimed only by that member's runner; an agent's webhook run routes to the agent owner's runner; a killed runner's `running` run is force-failed by the reaper within the stale window.

- [ ] **Step 4: Commit any fixes, then tag readiness**

```bash
git add -A && git commit -m "test: end-to-end verification for multi-user foundation" || echo "nothing to commit"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** SSO (T10–12), user model (T1,5), runner binding (T6), run ownership across all 5 sites (T6,8,13), user-scoped claimNext (T7), reaper (T9), authorization/visibility (T13,14), containerization + migrate-at-start (T3,15), runbook/runner (T16), `AUTH_ENABLED` gate + migration backfill (T2,4,11), client login/roles (T17,18). All spec sections map to a task.
- **Type consistency:** `create({...userId})`, `claimNext(runnerId, runnerUserId)`, `ownerForAgent`, `UserRepository.upsertByEntraOid/findByEntraOid/findById/setRole`, `requireUser/requireAdmin`, `buildHumanRunsRoutes/buildRunnerRunsRoutes/buildAuthRoutes/buildUsersRoutes` are used consistently across tasks.
- **Known confirm-at-build items (flagged inline, not placeholders):** exact `openid-client@^6` and `@fastify/secure-session@^8` API surfaces; the build step copying `dist/db/migrations`. Each has a concrete default + a one-line verification.
```
