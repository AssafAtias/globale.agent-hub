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
      skills TEXT NOT NULL DEFAULT '[]',
      focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT,
      result TEXT, error TEXT, created_at TEXT NOT NULL,
      started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE TABLE IF NOT EXISTS runners (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
      last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline'
    );
  `);
  return db;
}

const config = { ...loadConfig(), DATABASE_URL: ':memory:' };
const app = buildApp(config);

beforeEach(() => {
  resetDb();
  setupInMemoryDb();
});

afterAll(() => resetDb());

async function createAgent() {
  const res = await app.inject({
    method: 'POST', url: '/api/agents',
    payload: {
      name: 'Test', type: 'pr-review', model: 'claude-haiku-4-5',
      prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
    },
  });
  return res.json() as { id: string };
}

async function registerRunner() {
  const res = await app.inject({
    method: 'POST', url: '/api/runners/register',
    payload: { name: 'test-runner' },
  });
  return res.json() as { runnerId: string; token: string };
}

describe('Runs API', () => {
  it('POST /api/runs creates a manual run', async () => {
    const agent = await createAgent();
    const res = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending');
    expect(res.json().trigger).toBe('manual');
  });

  it('POST /api/runs returns 404 for unknown agent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { agentId: 'nonexistent' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/runs/next claims a pending run', async () => {
    const agent = await createAgent();
    await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } });
    const { token } = await registerRunner();

    const res = await app.inject({
      method: 'GET', url: '/api/runs/next',
      headers: { 'x-runner-token': token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().run.status).toBe('running');
    expect(res.json().agent).toBeDefined();
  });

  it('GET /api/runs/next returns 401 for invalid token', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/runs/next',
      headers: { 'x-runner-token': 'bad-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/runs/:id/result marks run done', async () => {
    const agent = await createAgent();
    const { id: runId } = (await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { agentId: agent.id },
    })).json();
    const { token } = await registerRunner();

    // Claim the run
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': token } });

    // Post result
    const res = await app.inject({
      method: 'POST', url: `/api/runs/${runId}/result`,
      headers: { 'x-runner-token': token },
      payload: { result: '## Review\nLooks good.' },
    });
    expect(res.statusCode).toBe(200);

    // Verify run is done
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}` })).json();
    expect(run.status).toBe('done');
    expect(run.result).toBe('## Review\nLooks good.');
  });

  it('POST /api/runs/:id/result marks run failed when error provided', async () => {
    const agent = await createAgent();
    const { id: runId } = (await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { agentId: agent.id },
    })).json();
    const { token } = await registerRunner();

    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': token } });

    await app.inject({
      method: 'POST', url: `/api/runs/${runId}/result`,
      headers: { 'x-runner-token': token },
      payload: { error: 'Claude API timeout' },
    });

    const run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}` })).json();
    expect(run.status).toBe('failed');
    expect(run.error).toBe('Claude API timeout');
  });

  it('POST /api/runners/register returns token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/runners/register',
      payload: { name: 'my-runner' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().runnerId).toBeDefined();
    expect(res.json().token).toBeDefined();
  });

  it('PATCH /api/runs/:id archives and unarchives a run', async () => {
    const agent = await createAgent();
    const { id: runId } = (await app.inject({
      method: 'POST', url: '/api/runs', payload: { agentId: agent.id },
    })).json();

    // Newly created run is not archived
    let run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}` })).json();
    expect(run.archived).toBe(false);

    // Archive it
    const archiveRes = await app.inject({
      method: 'PATCH', url: `/api/runs/${runId}`, payload: { archived: true },
    });
    expect(archiveRes.statusCode).toBe(200);
    expect(archiveRes.json().archived).toBe(true);

    run = (await app.inject({ method: 'GET', url: `/api/runs/${runId}` })).json();
    expect(run.archived).toBe(true);

    // Unarchive it
    const unarchiveRes = await app.inject({
      method: 'PATCH', url: `/api/runs/${runId}`, payload: { archived: false },
    });
    expect(unarchiveRes.statusCode).toBe(200);
    expect(unarchiveRes.json().archived).toBe(false);
  });

  it('PATCH /api/runs/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/runs/nonexistent', payload: { archived: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
