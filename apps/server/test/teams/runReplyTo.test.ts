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
