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

  it('findAllForUser returns only that user\'s runs', () => {
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u1' });
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}', userId: 'u2' });
    expect(RunRepository.findAllForUser('u1')).toHaveLength(1);
  });
});
