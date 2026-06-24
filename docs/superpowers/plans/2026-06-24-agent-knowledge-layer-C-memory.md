# Agent Knowledge Layer — Plan C: Context + Memory Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent a user-editable Focus and an auto-accumulating memory bank (notes the agent appends after each run), both injected into future runs and surfaced in the UI.

**Architecture:** A nullable `focus` column on `agents` plus an `agent_memory` table store the data; the server exposes memory endpoints. The client edits Focus in agent config and shows the memory log (read-only, clearable) on the profile. The runner fetches focus + recent memory before a run, injects them into the system prompt with a `<memory-update>` instruction, then extracts and persists any block the agent emits.

**Tech Stack:** Fastify 5 + TypeBox + Drizzle/better-sqlite3 (server, jest); React 18 + MUI 7 + TanStack Query (client, vitest); Node + `@anthropic-ai/sdk` (runner, vitest).

**Depends on:** Plan B (runner `executeJob` already takes `skillsDir` and prepends a `## Skills` section; this plan adds Focus + Memory sections after it).

## Global Constraints

- `focus`: nullable text on `agents`, max 4000 chars, edited via the existing `PUT /api/agents/:id`.
- `agent_memory` rows: `{ id, agentId→agents, runId (nullable), note, createdAt }`.
- `MEMORY_INJECT_LIMIT = 20` most-recent entries, newest-first, both in the GET response and in prompt injection.
- No runtime DB migrator — generate a drizzle migration and apply it manually + idempotently to the dev DBs (`agent-hub.db` and `apps/server/agent-hub.db`), as in the activity-archive feature.
- The agent records memory by ending its reply with a single `<memory-update>…</memory-update>` block; the runner extracts the first such block, strips it from the displayed result, and persists it. Absent/malformed block → no write, never an error.
- A failed memory POST is logged and must not fail the run.
- Follow existing patterns (TypeBox schemas, react-query, factory routes, `Type.Any()` responses where the repo uses them).

---

### Task 1: Server — focus column, agent_memory table, repository, and memory endpoints

**Files:**
- Modify: `apps/server/src/db/schema.ts` (focus column + `agentMemory` table)
- Create: `apps/server/src/db/migrations/0003_*.sql` (drizzle-kit generated)
- Create: `apps/server/src/services/AgentMemoryRepository.ts`
- Modify: `apps/server/src/services/AgentRepository.ts` (allow `focus`)
- Modify: `apps/server/src/api/routes/agents.ts` (focus in body + memory routes)
- Create: `apps/server/test/agentMemory.test.ts`

**Interfaces:**
- Produces: `agents.focus: string | null`; table `agent_memory`.
- Produces: `AgentMemoryRepository.listForAgent(agentId, limit): MemoryRow[]` (newest-first), `.append({ agentId, runId, note }): MemoryRow`, `.clearForAgent(agentId): void`.
- Produces: `GET /api/agents/:id/memory` → `{ focus: string | null, entries: { id, runId, note, createdAt }[] }` (404 if agent missing).
- Produces: `POST /api/agents/:id/memory` body `{ runId?: string, note: string }` → `201` created entry (404 missing agent, 400 empty note).
- Produces: `DELETE /api/agents/:id/memory` → `204`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/agentMemory.test.ts`:

```ts
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/environment.js';
import { getDb, resetDb } from '../src/db/client.js';

function setupInMemoryDb() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, prompt TEXT NOT NULL, repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]', focus TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, run_id TEXT,
      note TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
  `);
  return db;
}

const config = { ...loadConfig(), DATABASE_URL: ':memory:' };
const app = buildApp(config);

beforeEach(() => { resetDb(); setupInMemoryDb(); });
afterAll(() => resetDb());

async function createAgent() {
  const res = await app.inject({
    method: 'POST', url: '/api/agents',
    payload: { name: 'Mem', type: 'pr-review', model: 'claude-haiku-4-5',
      prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [] },
  });
  return res.json() as { id: string };
}

describe('Agent memory API', () => {
  it('focus round-trips through PUT and GET memory', async () => {
    const { id } = await createAgent();
    await app.inject({ method: 'PUT', url: `/api/agents/${id}`, payload: { focus: 'Ship the archive feature' } });
    const res = await app.inject({ method: 'GET', url: `/api/agents/${id}/memory` });
    expect(res.statusCode).toBe(200);
    expect(res.json().focus).toBe('Ship the archive feature');
    expect(res.json().entries).toEqual([]);
  });

  it('appends and lists entries newest-first', async () => {
    const { id } = await createAgent();
    await app.inject({ method: 'POST', url: `/api/agents/${id}/memory`, payload: { note: 'first', runId: 'r1' } });
    await app.inject({ method: 'POST', url: `/api/agents/${id}/memory`, payload: { note: 'second' } });
    const res = await app.inject({ method: 'GET', url: `/api/agents/${id}/memory` });
    const notes = res.json().entries.map((e: any) => e.note);
    expect(notes).toEqual(['second', 'first']);
    expect(res.json().entries[1].runId).toBe('r1');
  });

  it('rejects an empty note with 400', async () => {
    const { id } = await createAgent();
    const res = await app.inject({ method: 'POST', url: `/api/agents/${id}/memory`, payload: { note: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for memory of an unknown agent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/nope/memory' });
    expect(res.statusCode).toBe(404);
  });

  it('clears all entries', async () => {
    const { id } = await createAgent();
    await app.inject({ method: 'POST', url: `/api/agents/${id}/memory`, payload: { note: 'x' } });
    const del = await app.inject({ method: 'DELETE', url: `/api/agents/${id}/memory` });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({ method: 'GET', url: `/api/agents/${id}/memory` });
    expect(res.json().entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && npx jest agentMemory.test`
Expected: FAIL — memory routes not registered (404/400 assertions fail; `focus` not returned).

- [ ] **Step 3: Update the schema**

In `apps/server/src/db/schema.ts`:

Add `focus` to the `agents` table (after `skills`):
```ts
  focus: text('focus'),
```

Add the new table at the end of the file:
```ts
export const agentMemory = sqliteTable('agent_memory', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  runId: text('run_id'),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
});
```

- [ ] **Step 4: Generate and apply the migration**

Generate:
Run: `cd apps/server && npx drizzle-kit generate`
Expected: creates `apps/server/src/db/migrations/0003_*.sql` with `ALTER TABLE agents ADD focus text;` and `CREATE TABLE agent_memory (...)`, and updates the snapshot.

Apply to dev DBs (idempotent), from the repo root:
```bash
node -e "for (const f of ['agent-hub.db','apps/server/agent-hub.db']) { try { const d=require('better-sqlite3')(f); const cols=d.prepare('PRAGMA table_info(agents)').all().map(c=>c.name); if(!cols.includes('focus')) d.exec('ALTER TABLE agents ADD COLUMN focus TEXT'); d.exec('CREATE TABLE IF NOT EXISTS agent_memory (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, run_id TEXT, note TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (agent_id) REFERENCES agents(id))'); console.log('migrated',f); d.close(); } catch(e){ console.log('skip',f,e.message);} }"
```
Expected: `migrated agent-hub.db` and `migrated apps/server/agent-hub.db`. Stop the server first if a DB is locked.

- [ ] **Step 5: Create AgentMemoryRepository**

Create `apps/server/src/services/AgentMemoryRepository.ts`:

```ts
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { agentMemory } from '../db/schema.js';

export type MemoryRow = typeof agentMemory.$inferSelect;

export const AgentMemoryRepository = {
  listForAgent(agentId: string, limit: number): MemoryRow[] {
    return getDb().select().from(agentMemory)
      .where(eq(agentMemory.agentId, agentId))
      .orderBy(desc(agentMemory.createdAt))
      .limit(limit)
      .all();
  },
  append(data: { agentId: string; runId: string | null; note: string }): MemoryRow {
    const row: MemoryRow = {
      id: randomUUID(),
      agentId: data.agentId,
      runId: data.runId,
      note: data.note,
      createdAt: new Date().toISOString(),
    };
    getDb().insert(agentMemory).values(row).run();
    return row;
  },
  clearForAgent(agentId: string): void {
    getDb().delete(agentMemory).where(eq(agentMemory.agentId, agentId)).run();
  },
};
```

- [ ] **Step 6: Allow `focus` in AgentRepository**

In `apps/server/src/services/AgentRepository.ts`:

Add `'focus'` to the `Omit` list and add `focus?: string | null;` to the `AgentInsert` intersection:
```ts
export type AgentInsert = Omit<AgentRow, 'id' | 'createdAt' | 'enabled' | 'avatarKey' | 'title' | 'bio' | 'skills' | 'focus'> & {
  enabled?: boolean;
  avatarKey?: string | null;
  title?: string | null;
  bio?: string | null;
  skills?: string;
  focus?: string | null;
};
```
In `create`, add to the row literal (after `skills`):
```ts
      focus: data.focus ?? null,
```

- [ ] **Step 7: Add `focus` to the body schema and register memory routes**

In `apps/server/src/api/routes/agents.ts`:

Add the import:
```ts
import { AgentMemoryRepository } from '../../services/AgentMemoryRepository.js';
```

Add `focus` to `AgentBody` (after `skills`):
```ts
  focus: Type.Optional(Type.String({ maxLength: 4000 })),
```

In the `POST /api/agents` handler's `create` call, add (after `skills: ...`):
```ts
        focus: req.body.focus ?? null,
```
(The `PUT` handler already spreads `body` into `patch`; `focus` is plain text needing no JSON serialization, so it flows through unchanged.)

Add these three routes inside `agentsRoutes`, after the `DELETE /api/agents/:id` route:
```ts
  const MEMORY_INJECT_LIMIT = 20;

  app.get('/api/agents/:id/memory', {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    const entries = AgentMemoryRepository.listForAgent(req.params.id, MEMORY_INJECT_LIMIT)
      .map((e) => ({ id: e.id, runId: e.runId, note: e.note, createdAt: e.createdAt }));
    return { focus: agent.focus ?? null, entries };
  });

  app.post('/api/agents/:id/memory', {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({ runId: Type.Optional(Type.String()), note: Type.String() }),
      response: { 201: Type.Any(), 400: Type.Any(), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    if (!req.body.note.trim()) return reply.status(400).send({ error: 'note is required' });
    const entry = AgentMemoryRepository.append({
      agentId: req.params.id, runId: req.body.runId ?? null, note: req.body.note.trim(),
    });
    return reply.status(201).send(entry);
  });

  app.delete('/api/agents/:id/memory', {
    schema: { params: Type.Object({ id: Type.String() }), response: { 204: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    AgentMemoryRepository.clearForAgent(req.params.id);
    return reply.status(204).send();
  });
```

- [ ] **Step 8: Run the full server suite**

Run: `cd apps/server && npx jest`
Expected: PASS — all suites including the new `agentMemory.test` (5 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/migrations apps/server/src/services/AgentMemoryRepository.ts apps/server/src/services/AgentRepository.ts apps/server/src/api/routes/agents.ts apps/server/test/agentMemory.test.ts
git commit -m "feat(server): agent focus column + memory bank endpoints"
```

---

### Task 2: Client — Focus field and memory viewer

**Files:**
- Modify: `apps/client/src/api/client.ts` (Agent.focus, AgentInput.focus, memory api)
- Modify: `apps/client/src/pages/AgentConfigPage.tsx` (Focus field)
- Modify: `apps/client/src/pages/AgentProfilePage.tsx` (Memory section)

**Interfaces:**
- Consumes: memory endpoints (Task 1).
- Produces: `api.agents.memory.get(id)`, `.append(id, { runId?, note })`, `.clear(id)`; `Agent.focus?: string | null`; `AgentInput.focus?: string`.

- [ ] **Step 1: Add types and memory API methods**

In `apps/client/src/api/client.ts`:

Add `focus?: string | null;` to the `Agent` interface and `focus?: string;` to `AgentInput`.

Add an interface near the others:
```ts
export interface MemoryEntry { id: string; runId: string | null; note: string; createdAt: string; }
export interface AgentMemory { focus: string | null; entries: MemoryEntry[]; }
```

Add a `memory` sub-object inside the `agents` block of `api` (after `delete`):
```ts
    memory: {
      get: (id: string) => req<AgentMemory>(`/api/agents/${id}/memory`),
      append: (id: string, body: { runId?: string; note: string }) =>
        req<MemoryEntry>(`/api/agents/${id}/memory`, { method: 'POST', body: JSON.stringify(body) }),
      clear: (id: string) => req<void>(`/api/agents/${id}/memory`, { method: 'DELETE' }),
    },
```

- [ ] **Step 2: Add the Focus field to AgentConfigPage**

In `apps/client/src/pages/AgentConfigPage.tsx`:

Add state (after the `bio` state):
```ts
  const [focus, setFocus] = useState('');
```
In the load `.then`, after `setBio(...)`:
```ts
        setFocus(a.focus ?? '');
```
In the `save` body object, after `bio: ...`:
```ts
      focus: focus.trim() || undefined,
```
In the JSX, add a field after the Bio `TextField`:
```tsx
        <TextField
          label="Focus" value={focus} onChange={e => setFocus(e.target.value)}
          fullWidth multiline minRows={2}
          placeholder="What this agent is currently working on"
          helperText="Injected into every run as the agent's current focus."
        />
```

- [ ] **Step 3: Add the Memory section to AgentProfilePage**

In `apps/client/src/pages/AgentProfilePage.tsx`:

Add imports:
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
```
(Keep existing imports; `api` and `Divider`, `Button`, `Stack`, `Typography` are already imported.)

Inside the component, after the existing `useRuns()` line, add the memory query + clear mutation:
```ts
  const qc = useQueryClient();
  const { data: memory } = useQuery({
    queryKey: ['agent-memory', id],
    queryFn: () => api.agents.memory.get(id!),
    enabled: !!id,
  });
  const clearMemory = useMutation({
    mutationFn: () => api.agents.memory.clear(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-memory', id] }),
  });
```

Add a Memory section in the JSX, immediately before the `<Box mt={3}>` that holds the "Configure agent" button:
```tsx
      <Divider sx={{ my: 3 }} />
      <Box display="flex" alignItems="center" gap={2} mb={1}>
        <Typography variant="subtitle2" flex={1}>Memory</Typography>
        {(memory?.entries.length ?? 0) > 0 && (
          <Button size="small" color="warning"
            onClick={() => { if (confirm('Clear all memory for this agent?')) clearMemory.mutate(); }}>
            Clear memory
          </Button>
        )}
      </Box>
      {memory?.focus && (
        <Typography variant="body2" sx={{ mb: 2, fontStyle: 'italic' }}>
          Focus: {memory.focus}
        </Typography>
      )}
      {memory && memory.entries.length > 0 ? (
        <Stack spacing={1}>
          {memory.entries.map((e) => (
            <Box key={e.id}>
              <Typography variant="body2">{e.note}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(e.createdAt).toLocaleString()}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : <Typography color="text.secondary" variant="body2">No memory yet.</Typography>}
```

- [ ] **Step 4: Verify build and existing tests**

Run: `cd apps/client && npx tsc --noEmit && npx vitest run`
Expected: no type errors; existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/api/client.ts apps/client/src/pages/AgentConfigPage.tsx apps/client/src/pages/AgentProfilePage.tsx
git commit -m "feat(client): agent Focus field and memory viewer"
```

---

### Task 3: Runner — inject focus + memory and persist memory updates

**Files:**
- Modify: `packages/runner/src/executor.ts` (extract function, inject, return shape)
- Modify: `packages/runner/src/poller.ts` (fetch memory, post note)
- Create: `packages/runner/test/memoryUpdate.test.ts`

**Interfaces:**
- Consumes: `GET/POST /api/agents/:id/memory` (Task 1); `executeJob(job, apiKey, localReposRoot, skillsDir)` from Plan B.
- Produces: `extractMemoryUpdate(text: string): { result: string; note: string | null }` — returns the text with the first `<memory-update>…</memory-update>` block removed and the trimmed block contents as `note` (or `null` if none).
- Produces: new `executeJob` signature `executeJob(job, apiKey, localReposRoot, skillsDir, memory): Promise<{ result: string; note: string | null }>` where `memory: { focus: string | null; entries: { note: string }[] }`.

- [ ] **Step 1: Write the failing extractor test**

Create `packages/runner/test/memoryUpdate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractMemoryUpdate } from '../src/executor.js';

describe('extractMemoryUpdate', () => {
  it('extracts and strips the first memory-update block', () => {
    const text = 'Review done.\n\n<memory-update>\nMerchant X needs RTL fix.\n</memory-update>';
    const { result, note } = extractMemoryUpdate(text);
    expect(note).toBe('Merchant X needs RTL fix.');
    expect(result).toBe('Review done.');
    expect(result).not.toContain('<memory-update>');
  });

  it('returns null note and unchanged result when no block present', () => {
    const { result, note } = extractMemoryUpdate('Just a normal answer.');
    expect(note).toBeNull();
    expect(result).toBe('Just a normal answer.');
  });

  it('takes only the first block', () => {
    const text = 'A<memory-update>one</memory-update>B<memory-update>two</memory-update>';
    const { note } = extractMemoryUpdate(text);
    expect(note).toBe('one');
  });

  it('treats an empty block as no note', () => {
    const { note } = extractMemoryUpdate('done <memory-update>   </memory-update>');
    expect(note).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/runner && npx vitest run memoryUpdate`
Expected: FAIL — `extractMemoryUpdate` is not exported from executor.

- [ ] **Step 3: Implement the extractor and inject focus + memory**

In `packages/runner/src/executor.ts`:

Add the exported extractor (near the other helpers):
```ts
export function extractMemoryUpdate(text: string): { result: string; note: string | null } {
  const m = text.match(/<memory-update>([\s\S]*?)<\/memory-update>/);
  if (!m) return { result: text, note: null };
  const note = m[1].trim();
  const result = (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim();
  return { result, note: note.length > 0 ? note : null };
}
```

Add the `MemoryInput` type and change `executeJob` to accept memory, build the fuller prompt, and return `{ result, note }`:
```ts
export interface MemoryInput {
  focus: string | null;
  entries: { note: string }[];
}

const MEMORY_INSTRUCTION =
  'To record something for your future self, end your reply with a single ' +
  '<memory-update>...</memory-update> block containing a concise note (what you did / what you learned). ' +
  'Write nothing there if there is nothing worth remembering.';

export async function executeJob(
  job: Job, apiKey: string, localReposRoot: string, skillsDir: string, memory: MemoryInput,
): Promise<{ result: string; note: string | null }> {
  const enricher = new LocalEnricher(localReposRoot);
  const agentRepos = (() => { try { return JSON.parse(job.agent.repos || '[]') as string[]; } catch { return [] as string[]; } })();
  const enrichedContextStr = enricher.enrich(job.run.context, agentRepos);
  const contextText = formatContext(safeParseContext(enrichedContextStr));

  const skillNames = (() => { try { return JSON.parse(job.agent.skills || '[]') as string[]; } catch { return [] as string[]; } })();
  const skillsText = new SkillLoader(skillsDir).load(skillNames);

  const parts: string[] = [];
  if (skillsText) parts.push(`## Skills\n\n${skillsText}`);
  if (memory.focus && memory.focus.trim()) parts.push(`## Focus\n\n${memory.focus.trim()}`);
  if (memory.entries.length > 0) {
    const bullets = memory.entries.map((e) => `- ${e.note}`).join('\n');
    parts.push(`## Memory (recent)\n\n${bullets}\n\n${MEMORY_INSTRUCTION}`);
  } else {
    parts.push(MEMORY_INSTRUCTION);
  }
  parts.push(job.agent.prompt);
  const systemPrompt = parts.join('\n\n---\n\n');

  const raw = await runClaude(apiKey, job.agent.model, systemPrompt, contextText);
  return extractMemoryUpdate(raw);
}
```

- [ ] **Step 4: Run the extractor test to verify it passes**

Run: `cd packages/runner && npx vitest run memoryUpdate`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Fetch memory and post the note in the poller**

In `packages/runner/src/poller.ts`:

Add two helpers (near `postResult`):
```ts
async function fetchMemory(config: RunnerConfig, agentId: string): Promise<{ focus: string | null; entries: { note: string }[] }> {
  try {
    const res = await fetch(`${config.orchestratorUrl}/api/agents/${agentId}/memory`, {
      headers: { 'x-runner-token': config.runnerToken },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { focus: null, entries: [] };
    return await res.json();
  } catch {
    return { focus: null, entries: [] };
  }
}

async function postMemory(config: RunnerConfig, agentId: string, body: { runId: string; note: string }) {
  try {
    await fetch(`${config.orchestratorUrl}/api/agents/${agentId}/memory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-runner-token': config.runnerToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(`[runner] failed to save memory for agent ${agentId}:`, err);
  }
}
```

Update the execute/postResult block in the poll loop:
```ts
      try {
        const memory = await fetchMemory(config, job.run.agentId);
        const { result, note } = await executeJob(job, config.anthropicApiKey, config.localReposRoot, config.skillsDir, memory);
        await postResult(config, job.run.id, { result });
        if (note) await postMemory(config, job.run.agentId, { runId: job.run.id, note });
        console.log(`[runner] Run ${job.run.id} completed`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await postResult(config, job.run.id, { error });
        console.error(`[runner] Run ${job.run.id} failed: ${error}`);
      }
```

(`job.run.agentId` is already part of the `Job` type's `run`. The `GET /api/runs/next` response includes it.)

- [ ] **Step 6: Build the runner and run its tests**

Run: `cd packages/runner && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all runner tests pass (SkillLoader from Plan B + memoryUpdate).

- [ ] **Step 7: Commit**

```bash
git add packages/runner/src/executor.ts packages/runner/src/poller.ts packages/runner/test/memoryUpdate.test.ts
git commit -m "feat(runner): inject focus + memory and persist memory-update notes"
```

---

## Self-Review Notes

- **Spec coverage (C):** focus column + agent_memory + repository + endpoints → C1; Focus field + memory viewer + clear → C2; runner fetch/inject/extract/persist → C3. All C requirements covered.
- **Type consistency:** `AgentMemory { focus, entries }` and `MemoryEntry` consistent across server response, client api, and runner `MemoryInput` (runner only needs `{ focus, entries: { note }[] }`, a structural subset — compatible). `executeJob` 5-arg signature + `{ result, note }` return updated in executor (def) and poller (call). `MEMORY_INJECT_LIMIT = 20` used in both the GET handler and documented for injection.
- **Migration:** C1 Step 4 generates the drizzle migration and applies it idempotently to both dev DBs (focus column guarded by `PRAGMA`, table by `IF NOT EXISTS`).
- **No-fail memory writes:** `postMemory`/`fetchMemory` swallow errors and log — a memory failure never fails the run (Global Constraint satisfied).
- **Dependency on B:** C3 rewrites the `executeJob` that Plan B introduced; this plan must run after Plan B.
