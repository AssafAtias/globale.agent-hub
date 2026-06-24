import { getDb, resetDb } from '../src/db/client.js';
import { agents } from '../src/db/schema.js';

beforeEach(() => {
  resetDb();
});

it('inserts and retrieves an agent from in-memory DB', () => {
  const db = getDb(':memory:');

  // Create tables in the in-memory DB using the underlying better-sqlite3 client
  const sqlite = (db as any).$client;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      repos TEXT NOT NULL,
      trigger_rules TEXT NOT NULL,
      outputs TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      avatar_key TEXT,
      title TEXT,
      bio TEXT,
      skills TEXT NOT NULL DEFAULT '[]',
      focus TEXT
    )
  `);

  const id = 'test-uuid-1234';
  db.insert(agents).values({
    id,
    name: 'Test Agent',
    type: 'pr-review',
    model: 'claude-haiku-4-5',
    prompt: 'Review this',
    repos: '[]',
    triggerRules: '{}',
    outputs: '[]',
    enabled: true,
    createdAt: new Date().toISOString(),
  }).run();

  const result = db.select().from(agents).all();
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Test Agent');
  expect(result[0].id).toBe(id);
});
