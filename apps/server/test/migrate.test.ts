// apps/server/test/migrate.test.ts
import { getDb, resetDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

describe('runMigrations', () => {
  beforeEach(() => resetDb());
  afterAll(() => resetDb());

  it('creates the full schema on a fresh in-memory db and is safe to run twice', () => {
    runMigrations(':memory:');
    runMigrations(':memory:'); // idempotent — journal skips applied
    const s = (getDb(':memory:') as any).$client;
    const cols = s.prepare('PRAGMA table_info(agents)').all().map((c: any) => c.name);
    expect(cols).toContain('owner_id');
  });

  it('baselines a legacy DB (0000–0006 applied by hand) and applies only 0007', () => {
    // Simulate a legacy DB: tables exist (as of 0006 schema) but NO __drizzle_migrations.
    // We replicate the schema from migration-0007.test.ts's setup (pre-0007 shape).
    const db = getDb(':memory:');
    const s = (db as any).$client;
    s.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE runners (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline');
      CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO agents VALUES ('a1', 'Legacy Agent', '2026-01-01T00:00:00.000Z');
    `);

    // Must not throw — baseline detection prevents replaying 0000–0006
    expect(() => runMigrations(':memory:')).not.toThrow();

    // 0007 should have been applied: agents now has owner_id column
    const cols: string[] = s.prepare('PRAGMA table_info(agents)').all().map((c: any) => c.name);
    expect(cols).toContain('owner_id');

    // The pre-existing agent should have been backfilled with the bootstrap admin id
    const agent = s.prepare('SELECT owner_id FROM agents WHERE id=?').get('a1') as { owner_id: string };
    expect(agent.owner_id).toBe('bootstrap-admin');
  });
});
