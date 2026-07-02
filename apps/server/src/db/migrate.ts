import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { getDb } from './client.js';
import type Database from 'better-sqlite3';

/** Apply all pending Drizzle migrations (journal-aware, idempotent). */
export function runMigrations(url: string): void {
  const db = getDb(url);
  const sqlite = (db as any).$client as Database.Database;

  // Detect a legacy DB: no __drizzle_migrations table but an agents table exists.
  // This means migrations 0000–0006 were applied by hand without Drizzle's tracker.
  // We seed a baseline row at the 0006 timestamp so Drizzle only runs 0007+.
  const hasMigrationsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get('__drizzle_migrations');

  const hasAgentsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get('agents');

  if (!hasMigrationsTable && hasAgentsTable) {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)'
    );
    const seeded = sqlite
      .prepare('SELECT COUNT(*) AS n FROM `__drizzle_migrations`')
      .get() as { n: number };
    if (seeded.n === 0) {
      sqlite
        .prepare('INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)')
        .run('baseline-0006', 1782750000000);
    }
  }

  // migrations folder lives next to this compiled file (dist/db/migrations at runtime,
  // src/db/migrations at test-time via ts-jest — both paths resolve correctly via __dirname).
  migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
}
