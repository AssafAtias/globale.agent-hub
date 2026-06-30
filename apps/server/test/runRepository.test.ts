import { getDb, resetDb } from '../src/db/client.js';
import { RunRepository } from '../src/services/RunRepository.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL,
      trigger_payload TEXT NOT NULL, context TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', runner_id TEXT,
      result TEXT, error TEXT, created_at TEXT NOT NULL,
      started_at TEXT, finished_at TEXT, archived INTEGER NOT NULL DEFAULT 0,
      session_id TEXT, pending_gate TEXT, pending_response TEXT, reply_to TEXT
    );`);
}

beforeEach(() => { resetDb(); setup(); });
afterAll(() => resetDb());

describe('RunRepository.createCompleted', () => {
  it('creates a run already in done status with a result', () => {
    const run = RunRepository.createCompleted({ agentId: 'a1', trigger: 'manual', result: 'No open tasks found.' });
    expect(run.status).toBe('done');
    expect(run.result).toBe('No open tasks found.');
    expect(run.finishedAt).not.toBeNull();
  });

  it('is not returned by claimNext', () => {
    RunRepository.createCompleted({ agentId: 'a1', trigger: 'manual', result: 'No open tasks found.' });
    expect(RunRepository.claimNext('runner-1')).toBeNull();
  });
});

describe('RunRepository.lastScheduledRun', () => {
  it('returns the most recent schedule-trigger run for the agent', async () => {
    RunRepository.create({ agentId: 'a', trigger: 'schedule', triggerPayload: '{}', context: '{}' });
    await new Promise(resolve => setTimeout(resolve, 1));
    const second = RunRepository.create({ agentId: 'a', trigger: 'schedule', triggerPayload: '{}', context: '{}' });
    const last = RunRepository.lastScheduledRun('a');
    expect(last?.id).toBe(second.id);
  });
  it('ignores non-schedule triggers', () => {
    RunRepository.create({ agentId: 'a', trigger: 'webhook', triggerPayload: '{}', context: '{}' });
    RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    expect(RunRepository.lastScheduledRun('a')).toBeNull();
  });
  it('returns null when the agent has no schedule runs', () => {
    expect(RunRepository.lastScheduledRun('nobody')).toBeNull();
  });
});
