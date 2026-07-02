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
      skills TEXT NOT NULL DEFAULT '[]',
      focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT,
      teams_target TEXT, owner_id TEXT
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT,
      result TEXT, error TEXT, created_at TEXT NOT NULL,
      started_at TEXT, finished_at TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      session_id TEXT, pending_gate TEXT, pending_response TEXT,
      reply_to TEXT, user_id TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    CREATE TABLE IF NOT EXISTS runners (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL,
      last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline', user_id TEXT
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

  async function createTicketAgent() {
    const res = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: { name: 'T2MR', type: 'ticket-to-code', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [] },
    });
    return res.json() as { id: string };
  }

  it('ticket-to-code manual run returns 400 when Jira not configured', async () => {
    const agent = await createTicketAgent();
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Jira/i);
  });

  it('non-ticket-to-code manual run still creates a pending run', async () => {
    const agent = await createAgent(); // type pr-review
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending');
  });

  it('POST /api/runs returns 409 for an archived agent', async () => {
    const agent = await createAgent();
    // Archive the agent via PATCH /api/agents/:id
    await app.inject({
      method: 'PATCH', url: `/api/agents/${agent.id}`,
      payload: { archived: true },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Agent is archived');
  });

  it('result with a gate parks the run in waiting_approval', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/result`, headers: { 'x-runner-token': reg.token },
      payload: { sessionId: 'sess-1', gate: { id: 'g', summary: 's', question: 'q', kind: 'approve_reject' } } });
    const run = (await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json();
    expect(run.status).toBe('waiting_approval');
    expect(run.sessionId).toBe('sess-1');
  });
  it('respond approve re-queues a waiting run', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/result`, headers: { 'x-runner-token': reg.token },
      payload: { sessionId: 'sess-1', gate: { id: 'g', summary: 's', question: 'q', kind: 'approve_reject' } } });
    const res = await app.inject({ method: 'POST', url: `/api/runs/${id}/respond`, payload: { decision: 'approve' } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json().status).toBe('pending');
  });
  it('respond returns 409 when run is not waiting_approval', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/runs/${id}/respond`, payload: { decision: 'approve' } })).statusCode).toBe(409);
  });
  it('respond reject marks the run rejected', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/result`, headers: { 'x-runner-token': reg.token },
      payload: { sessionId: 'sess-1', gate: { id: 'g', summary: 's', question: 'q', kind: 'approve_reject' } } });
    await app.inject({ method: 'POST', url: `/api/runs/${id}/respond`, payload: { decision: 'reject', message: 'no' } });
    expect((await app.inject({ method: 'GET', url: `/api/runs/${id}` })).json().status).toBe('rejected');
  });

  async function createAgentNamed(name: string) {
    const res = await app.inject({ method: 'POST', url: '/api/agents',
      payload: { name, type: 'pr-review', model: 'claude-haiku-4-5', prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [] } });
    return res.json() as { id: string };
  }

  async function completeWithHandoff(runId: string, token: string, handoff: unknown) {
    return app.inject({ method: 'POST', url: `/api/runs/${runId}/result`, headers: { 'x-runner-token': token },
      payload: { result: 'reviewed', handoff } });
  }

  it('a handoff to a real agent completes the parent AND spawns a handoff child', async () => {
    const reviewer = await createAgent();                 // pr-review
    const fixer = await createAgentNamed('fixer');        // slugify('fixer') === 'fixer'
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: reviewer.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await completeWithHandoff(id, reg.token, { agent: 'fixer', message: 'fix the bug' });
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json() as Array<any>;
    expect(runs.find((r: any) => r.id === id).status).toBe('done');
    const child = runs.find((r: any) => r.trigger === 'handoff' && r.agentId === fixer.id);
    expect(child).toBeTruthy();
    expect(JSON.parse(child.context)['Handoff request']).toBe('fix the bug');
  });

  it('an unknown handoff target completes the parent with no child', async () => {
    const reviewer = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: reviewer.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    await app.inject({ method: 'GET', url: '/api/runs/next', headers: { 'x-runner-token': reg.token } });
    await completeWithHandoff(id, reg.token, { agent: 'nope-not-real', message: 'x' });
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json() as Array<any>;
    expect(runs.find((r: any) => r.id === id).status).toBe('done');
    expect(runs.some((r: any) => r.trigger === 'handoff')).toBe(false);
  });

  it('POST /events appends (with runner token) and GET /events returns them', async () => {
    const agent = await createAgent();
    const { id } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { agentId: agent.id } })).json();
    const reg = (await app.inject({ method: 'POST', url: '/api/runners/register', payload: { name: 'r' } })).json();
    const post = await app.inject({ method: 'POST', url: `/api/runs/${id}/events`, headers: { 'x-runner-token': reg.token },
      payload: { seq: 0, kind: 'tool', label: 'Read', detail: 'foo.ts' } });
    expect(post.statusCode).toBe(200);
    const events = (await app.inject({ method: 'GET', url: `/api/runs/${id}/events` })).json();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ seq: 0, kind: 'tool', label: 'Read', detail: 'foo.ts' });
  });
  it('POST /events rejects a bad runner token with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs/whatever/events', headers: { 'x-runner-token': 'nope' },
      payload: { seq: 0, kind: 'x', label: 'y' } });
    expect(res.statusCode).toBe(401);
  });
});
