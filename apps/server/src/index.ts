import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { loadConfig } from './config/environment.js';
import { buildApp } from './app.js';
import { getDb } from './db/client.js';
import { startScheduler } from './services/Scheduler.js';
import { startVwoMonitor } from './services/monitoring/VwoAbMonitor.js';

// Load the repo-root .env so secrets (GITLAB_API_TOKEN, etc.) live in one file
// instead of being passed on the command line. Resolved from this compiled
// file's location (dist/) → repo root, so it works regardless of cwd.
loadEnv({ path: resolve(__dirname, '../../../.env') });

const config = loadConfig();
// Initialize the DB singleton with the configured path BEFORE anything else
// (buildApp/repositories) calls getDb() with the default. Without this, the
// documented DATABASE_URL env var is ignored and the server always opens
// ./agent-hub.db.
getDb(config.DATABASE_URL);
const app = buildApp(config);

app.listen({ port: Number(config.PORT), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  startScheduler();
  startVwoMonitor(process.env, app.log);
  app.log.info('Scheduler started');
});
