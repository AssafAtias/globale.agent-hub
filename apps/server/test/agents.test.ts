import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/environment.js';
import { getDb, resetDb } from '../src/db/client.js';

function setupInMemoryDb() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL,
      outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      avatar_key TEXT,
      title TEXT,
      bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]',
      focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      workflow TEXT
    )
  `);
  return db;
}

// Build app with in-memory DB config — the app factory is called once,
// but the DB singleton is reset between tests via resetDb()
const config = { ...loadConfig(), DATABASE_URL: ':memory:' };

beforeEach(() => {
  resetDb();
  setupInMemoryDb();
});

afterAll(() => {
  resetDb();
});

const app = buildApp(config);

describe('Agents API', () => {
  it('POST /api/agents creates an agent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'PR Review', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'Review PRs', repos: ['gitlab:test/repo'],
        triggerRules: { events: ['mr:opened'] },
        outputs: ['pr_comment', 'dashboard'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('PR Review');
  });

  it('GET /api/agents returns created agents', async () => {
    await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Test', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('GET /api/agents/:id returns a specific agent', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Specific', type: 'ticket-to-code', model: 'claude-opus-4-8',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
      },
    });
    const { id } = post.json();
    const get = await app.inject({ method: 'GET', url: `/api/agents/${id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().name).toBe('Specific');
  });

  it('GET /api/agents/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/agents/:id updates an agent', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Original', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
      },
    });
    const { id } = post.json();
    const put = await app.inject({
      method: 'PUT', url: `/api/agents/${id}`,
      payload: { name: 'Updated' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe('Updated');
  });

  it('DELETE /api/agents/:id removes the agent', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'To Delete', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
      },
    });
    const { id } = post.json();
    const del = await app.inject({ method: 'DELETE', url: `/api/agents/${id}` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(get.json()).toHaveLength(0);
  });

  it('POST + GET round-trips identity fields (avatar, title, bio, skills)', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Bug Hunter', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
        avatarKey: 'ember', title: 'Senior Bug Hunter',
        bio: 'Finds what others miss.', skills: ['Code Review', 'Testing'],
      },
    });
    expect(post.statusCode).toBe(201);
    const { id } = post.json();
    const get = await app.inject({ method: 'GET', url: `/api/agents/${id}` });
    const body = get.json();
    expect(body.avatarKey).toBe('ember');
    expect(body.title).toBe('Senior Bug Hunter');
    expect(body.bio).toBe('Finds what others miss.');
    expect(JSON.parse(body.skills)).toEqual(['Code Review', 'Testing']);
  });

  it('defaults skills to an empty array when omitted', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Plain', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
      },
    });
    expect(post.statusCode).toBe(201);
    expect(JSON.parse(post.json().skills)).toEqual([]);
  });

  it('rejects malformed skills (empty-string entries)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: {
        name: 'Bad', type: 'pr-review', model: 'claude-haiku-4-5',
        prompt: 'p', repos: [], triggerRules: { events: [] }, outputs: [],
        skills: [''],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  async function createNamed(name: string) {
    const res = await app.inject({
      method: 'POST', url: '/api/agents',
      payload: { name, type: 'pr-review', model: 'm', prompt: 'p',
        repos: [], triggerRules: { events: [] }, outputs: [] },
    });
    return res.json() as { id: string };
  }

  it('PATCH /api/agents/:id archives an agent and hides it from the default list', async () => {
    const { id } = await createNamed('Archivable');
    const patch = await app.inject({
      method: 'PATCH', url: `/api/agents/${id}`, payload: { archived: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().archived).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(list.json()).toHaveLength(0);

    const all = await app.inject({ method: 'GET', url: '/api/agents?includeArchived=true' });
    expect(all.json()).toHaveLength(1);
  });

  it('PATCH /api/agents/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/agents/nope', payload: { archived: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/agents/reorder persists a new order (and is not captured by /:id)', async () => {
    const a = await createNamed('A');
    const b = await createNamed('B');
    const c = await createNamed('C');

    const res = await app.inject({
      method: 'PATCH', url: '/api/agents/reorder',
      payload: { ids: [c.id, a.id, b.id] },
    });
    expect(res.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(list.json().map((x: { id: string }) => x.id)).toEqual([c.id, a.id, b.id]);
  });
});
