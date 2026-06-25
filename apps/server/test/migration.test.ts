import { getDb, resetDb } from '../src/db/client.js';

// The 0004 backfill SQL — kept in sync with migrations/0004_*.sql.
const BACKFILL_SQL = `
  UPDATE agents SET sort_order = (
    SELECT COUNT(*) FROM agents AS a2
    WHERE a2.created_at < agents.created_at
       OR (a2.created_at = agents.created_at AND a2.id < agents.id)
  )
`;

function setupAgentsTable() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, prompt TEXT NOT NULL, repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL, outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      avatar_key TEXT, title TEXT, bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]', focus TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe('0004 sort_order backfill', () => {
  beforeEach(() => { resetDb(); setupAgentsTable(); });
  afterAll(() => resetDb());

  it('assigns distinct sequential sort_order by created_at', () => {
    const db = getDb(':memory:');
    const sqlite = (db as any).$client;
    const insert = sqlite.prepare(
      `INSERT INTO agents (id, name, type, model, prompt, repos, trigger_rules, outputs, created_at)
       VALUES (?, ?, 'pr-review', 'm', 'p', '[]', '{}', '[]', ?)`
    );
    // Inserted out of chronological order on purpose.
    insert.run('b', 'B', '2026-01-02T00:00:00.000Z');
    insert.run('a', 'A', '2026-01-01T00:00:00.000Z');
    insert.run('c', 'C', '2026-01-03T00:00:00.000Z');

    sqlite.exec(BACKFILL_SQL);

    const rows = sqlite.prepare('SELECT id, sort_order FROM agents ORDER BY sort_order').all();
    expect(rows).toEqual([
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
      { id: 'c', sort_order: 2 },
    ]);
  });
});
