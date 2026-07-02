import { ownerForAgent } from '../src/services/ownership.js';
import { getDb, resetDb } from '../src/db/client.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, owner_id TEXT);
    INSERT INTO agents VALUES ('a1','A','2026-01-01T00:00:00.000Z','owner-1');
    INSERT INTO agents VALUES ('a2','B','2026-01-01T00:00:00.000Z',NULL);
  `);
}

describe('ownerForAgent', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());
  it('returns the agent owner id or null', () => {
    expect(ownerForAgent('a1')).toBe('owner-1');
    expect(ownerForAgent('a2')).toBeNull();
    expect(ownerForAgent('missing')).toBeNull();
  });
});
