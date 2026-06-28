import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Environment } from './config/environment.js';
import { teamsEnabled } from './config/environment.js';
import { agentsRoutes } from './api/routes/agents.js';
import { buildRunsRoutes } from './api/routes/runs.js';
import { runnersRoutes } from './api/routes/runners.js';
import { buildWebhooksRoutes } from './api/routes/webhooks.js';
import { buildSkillsRoutes } from './api/routes/skills.js';
import { buildTeamsRoutes } from './api/routes/teams.js';
import { createTeamsAdapter, TeamsNotifier } from './services/teams/TeamsNotifier.js';
import { createTeamsBot } from './services/teams/TeamsBot.js';
import { getDb } from './db/client.js';

function assertTeamsColumns(): void {
  const db = getDb();
  const sqlite = (db as any).$client as import('better-sqlite3').Database;
  const has = (table: string, col: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === col);
  if (!has('agents', 'teams_target') || !has('runs', 'reply_to')) {
    throw new Error(
      'Teams is enabled but DB is missing teams_target/reply_to columns. ' +
      'Apply migration 0005_teams_integration.sql to agent-hub.db (server stopped) before starting.',
    );
  }
}

export function buildApp(config: Environment) {
  const app = Fastify({
    logger: { level: 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  let teamsNotifier: TeamsNotifier | undefined;
  if (teamsEnabled(config)) {
    assertTeamsColumns();
    const adapter = createTeamsAdapter(config);
    adapter.onTurnError = async (context, error) => {
      app.log.error(error, 'Teams turn error');
      await context.sendActivity('Sorry — something went wrong handling that.').catch(() => {});
    };
    const bot = createTeamsBot(config.TEAMS_ALLOWED_USER_IDS);
    teamsNotifier = new TeamsNotifier(adapter, config.MICROSOFT_APP_ID!);
    app.register(buildTeamsRoutes(adapter, bot));
  }

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(agentsRoutes);
  app.register(buildRunsRoutes(config, teamsNotifier));
  app.register(runnersRoutes);
  app.register(buildWebhooksRoutes(config));
  app.register(buildSkillsRoutes(config.SKILLS_DIR));

  return app;
}
