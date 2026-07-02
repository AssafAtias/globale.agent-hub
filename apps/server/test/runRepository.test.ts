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
      session_id TEXT, pending_gate TEXT, pending_response TEXT, reply_to TEXT, user_id TEXT
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
    expect(RunRepository.claimNext('runner-1', null)).toBeNull();
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

describe('gate lifecycle', () => {
  it('pauseForGate parks in waiting_approval with sessionId + gate', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.pauseForGate(r.id, 'sess-1', '{"id":"g","question":"q","kind":"approve_reject","summary":"s"}');
    const row = RunRepository.findById(r.id)!;
    expect(row.status).toBe('waiting_approval');
    expect(row.sessionId).toBe('sess-1');
    expect(row.pendingGate).toContain('"id":"g"');
  });
  it('resumeWithResponse re-queues with pendingResponse and clears the gate', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.pauseForGate(r.id, 'sess-1', '{"id":"g"}');
    RunRepository.resumeWithResponse(r.id, '{"decision":"approve"}');
    const row = RunRepository.findById(r.id)!;
    expect(row.status).toBe('pending');
    expect(row.pendingResponse).toContain('approve');
    expect(row.pendingGate).toBeNull();
  });
  it('claimNext returns the captured pendingResponse then nulls the column', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.pauseForGate(r.id, 'sess-1', '{"id":"g"}');
    RunRepository.resumeWithResponse(r.id, '{"decision":"approve"}');
    const claimed = RunRepository.claimNext('runner-1', null)!;
    expect(claimed.pendingResponse).toContain('approve');
    expect(RunRepository.findById(r.id)!.pendingResponse).toBeNull();
  });
  it('reject marks the run rejected', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.reject(r.id, 'not needed');
    expect(RunRepository.findById(r.id)!.status).toBe('rejected');
  });
  it('complete persists an optional sessionId', () => {
    const r = RunRepository.create({ agentId: 'a', trigger: 'manual', triggerPayload: '{}', context: '{}' });
    RunRepository.complete(r.id, 'done', 'sess-2');
    expect(RunRepository.findById(r.id)!.sessionId).toBe('sess-2');
  });
});
