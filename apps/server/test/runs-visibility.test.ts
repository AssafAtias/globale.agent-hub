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

describe('Run sub-resource ownership enforcement', () => {
  let ownerRunId: string;
  let otherRunId: string;

  beforeEach(() => {
    resetDb();
    setup();
    const ownerRun = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u1' });
    ownerRunId = ownerRun.id;
    const otherRun = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u2' });
    otherRunId = otherRun.id;
  });
  afterAll(() => resetDb());

  describe('PATCH /api/runs/:id (archive)', () => {
    it('member gets 404 for a run owned by another user', async () => {
      const app = await appAs({ id: 'u1', role: 'member' });
      const res = await app.inject({ method: 'PATCH', url: `/api/runs/${otherRunId}`, payload: { archived: true } });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('owner does NOT get the ownership-404', async () => {
      const app = await appAs({ id: 'u1', role: 'member' });
      const res = await app.inject({ method: 'PATCH', url: `/api/runs/${ownerRunId}`, payload: { archived: true } });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it('admin does NOT get the ownership-404', async () => {
      const app = await appAs({ id: 'admin', role: 'admin' });
      const res = await app.inject({ method: 'PATCH', url: `/api/runs/${otherRunId}`, payload: { archived: true } });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe('GET /api/runs/:id/events', () => {
    it('member gets 404 for events of a run owned by another user', async () => {
      const app = await appAs({ id: 'u1', role: 'member' });
      const res = await app.inject({ method: 'GET', url: `/api/runs/${otherRunId}/events` });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('owner does NOT get the ownership-404 for events', async () => {
      const app = await appAs({ id: 'u1', role: 'member' });
      const res = await app.inject({ method: 'GET', url: `/api/runs/${ownerRunId}/events` });
      expect(res.statusCode).toBe(200);
      await app.close();
    });

    it('admin does NOT get the ownership-404 for events', async () => {
      const app = await appAs({ id: 'admin', role: 'admin' });
      const res = await app.inject({ method: 'GET', url: `/api/runs/${otherRunId}/events` });
      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe('POST /api/runs/:id/respond', () => {
    it('member gets 404 for respond on a run owned by another user', async () => {
      // Set the other user's run to waiting_approval so the ownership check is reached
      RunRepository.pauseForGate(otherRunId, 'sess', JSON.stringify({ type: 'approval', message: 'ok?' }));
      const app = await appAs({ id: 'u1', role: 'member' });
      const res = await app.inject({
        method: 'POST', url: `/api/runs/${otherRunId}/respond`,
        payload: { decision: 'approve' },
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('owner does NOT get the ownership-404 for respond', async () => {
      RunRepository.pauseForGate(ownerRunId, 'sess', JSON.stringify({ type: 'approval', message: 'ok?' }));
      const app = await appAs({ id: 'u1', role: 'member' });
      const res = await app.inject({
        method: 'POST', url: `/api/runs/${ownerRunId}/respond`,
        payload: { decision: 'approve' },
      });
      // 409 = "not awaiting approval" shape-wise — but NOT 404 means ownership passed
      expect(res.statusCode).not.toBe(404);
      await app.close();
    });

    it('admin does NOT get the ownership-404 for respond', async () => {
      RunRepository.pauseForGate(otherRunId, 'sess', JSON.stringify({ type: 'approval', message: 'ok?' }));
      const app = await appAs({ id: 'admin', role: 'admin' });
      const res = await app.inject({
        method: 'POST', url: `/api/runs/${otherRunId}/respond`,
        payload: { decision: 'approve' },
      });
      expect(res.statusCode).not.toBe(404);
      await app.close();
    });
  });
});
