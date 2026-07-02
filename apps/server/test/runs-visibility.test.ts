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
  beforeEach(() => {
    resetDb();
    setup();
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
