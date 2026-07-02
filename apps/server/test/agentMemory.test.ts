import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/environment.js';
import { getDb, resetDb } from '../src/db/client.js';

function setupInMemoryDb() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      entra_object_id TEXT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, prompt TEXT NOT NULL, repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]', focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT,
      teams_target TEXT, owner_id TEXT
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
