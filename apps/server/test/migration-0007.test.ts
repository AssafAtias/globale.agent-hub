// apps/server/test/migration-0007.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb, resetDb } from '../src/db/client.js';

const SQL = readFileSync(join(__dirname, '../src/db/migrations/0007_multiuser.sql'), 'utf8');

function setup() {
  const db = getDb(':memory:');
  const s = (db as any).$client;
  s.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
    CREATE TABLE runners (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL, last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline');
    CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO runners VALUES ('r1','r','h','2026-01-01T00:00:00.000Z','offline');
    INSERT INTO agents VALUES ('a1','A','2026-01-01T00:00:00.000Z');
    INSERT INTO runs VALUES ('run1','a1','done','2026-01-01T00:00:00.000Z');
  `);
  return s;
}

describe('0007 multiuser migration', () => {
  beforeEach(() => { resetDb(); });
  afterAll(() => resetDb());

  it('adds columns and backfills a bootstrap admin as owner of all rows', () => {
    const s = setup();
    s.exec(SQL);
    const admin = s.prepare("SELECT id, role FROM users WHERE role='admin'").get();
    expect(admin).toBeTruthy();
    expect(s.prepare('SELECT user_id FROM runners WHERE id=?').get('r1').user_id).toBe(admin.id);
    expect(s.prepare('SELECT user_id FROM runs WHERE id=?').get('run1').user_id).toBe(admin.id);
    expect(s.prepare('SELECT owner_id FROM agents WHERE id=?').get('a1').owner_id).toBe(admin.id);
  });
});
