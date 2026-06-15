import { loadConfig } from './config.js';
import { startPollLoop } from './poller.js';

async function main() {
  const config = loadConfig();
  console.log(`[runner] "${config.runnerName}" starting up`);
  await startPollLoop(config);
}

main().catch(err => {
  console.error('[runner] Fatal:', err);
  process.exit(1);
});
