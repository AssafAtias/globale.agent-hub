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
  return (db as any).$client;
}

describe('reapStale', () => {
  beforeEach(() => { resetDb(); });
  afterAll(() => resetDb());

  it('fails running runs older than the timeout, leaves fresh ones', () => {
    const s = setup();
    const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const now = new Date('2026-01-01T00:20:00.000Z'); // +20min
    s.prepare(`INSERT INTO runs (id,agent_id,trigger,trigger_payload,context,status,started_at,created_at)
               VALUES ('r-old','a','manual','{}','{}','running',?,?)`).run(old, old);
    s.prepare(`INSERT INTO runs (id,agent_id,trigger,trigger_payload,context,status,started_at,created_at)
               VALUES ('r-new','a','manual','{}','{}','running',?,?)`).run(now.toISOString(), old);

    const n = RunRepository.reapStale(780000, now); // 13min
    expect(n).toBe(1);
    expect(RunRepository.findById('r-old')?.status).toBe('failed');
    expect(RunRepository.findById('r-new')?.status).toBe('running');
  });
});
