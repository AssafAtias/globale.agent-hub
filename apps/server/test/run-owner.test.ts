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
