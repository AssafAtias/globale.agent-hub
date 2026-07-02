import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { loadConfig } from './config/environment.js';
import { buildApp } from './app.js';
import { getDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { startScheduler } from './services/Scheduler.js';
import { startRunReaper } from './services/RunReaper.js';

// Load the repo-root .env so secrets (GITLAB_API_TOKEN, etc.) live in one file
// instead of being passed on the command line. Resolved from this compiled
// file's location (dist/) → repo root, so it works regardless of cwd.
loadEnv({ path: resolve(__dirname, '../../../.env') });

const config = loadConfig();
// Run migrations BEFORE buildApp/repositories touch the DB.
// runMigrations initialises the DB singleton (via getDb) and applies any
// pending Drizzle migrations (journal-aware, idempotent). On a legacy DB
// (0000–0006 applied by hand, no __drizzle_migrations table) it seeds a
// baseline row so only the new migrations (0007+) are replayed.
runMigrations(config.DATABASE_URL);
buildApp(config).then((app) => {
  app.listen({ port: Number(config.PORT), host: '0.0.0.0' }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    startScheduler();
    app.log.info('Scheduler started');
    if (process.env.NODE_ENV !== 'test') {
      startRunReaper(60_000, config.RUN_STALE_TIMEOUT_MS);
      app.log.info('RunReaper started');
    }
  });
}).catch((err) => {
  console.error('Failed to build app', err);
  process.exit(1);
});
