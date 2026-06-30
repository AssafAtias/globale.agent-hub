import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { loadConfig } from './config/environment.js';
import { buildApp } from './app.js';
import { startScheduler } from './services/Scheduler.js';

// Load the repo-root .env so secrets (GITLAB_API_TOKEN, etc.) live in one file
// instead of being passed on the command line. Resolved from this compiled
// file's location (dist/) → repo root, so it works regardless of cwd.
loadEnv({ path: resolve(__dirname, '../../../.env') });

const config = loadConfig();
const app = buildApp(config);

app.listen({ port: Number(config.PORT), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  startScheduler();
  app.log.info('Scheduler started');
});
