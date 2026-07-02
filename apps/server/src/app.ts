import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Environment } from './config/environment.js';
import { teamsEnabled } from './config/environment.js';
import { redactUrlToken } from './services/redactUrlToken.js';
import { agentsRoutes } from './api/routes/agents.js';
import { buildRunnerRunsRoutes, buildHumanRunsRoutes } from './api/routes/runs.js';
import { runnersRoutes } from './api/routes/runners.js';
import { buildWebhooksRoutes } from './api/routes/webhooks.js';
import { buildSkillsRoutes } from './api/routes/skills.js';
import { buildIntegrationsRoutes } from './api/routes/integrations.js';
import { buildDevToolsRoutes } from './api/routes/devTools.js';
import { buildTeamsRoutes } from './api/routes/teams.js';
import { createTeamsAdapter, TeamsNotifier } from './services/teams/TeamsNotifier.js';
import { createTeamsBot } from './services/teams/TeamsBot.js';
import { getDb } from './db/client.js';
import { registerAuth } from './api/plugins/authPlugin.js';
import { buildAuthRoutes } from './api/routes/auth.js';

function assertTeamsColumns(): void {
  const db = getDb();
  const sqlite = (db as any).$client as import('better-sqlite3').Database;
  const has = (table: string, col: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === col);
  if (!has('agents', 'teams_target') || !has('runs', 'reply_to')) {
    throw new Error(
      'Teams is enabled but DB is missing teams_target/reply_to columns. ' +
      'Apply migration 0006_teams_integration.sql to agent-hub.db (server stopped) before starting.',
    );
  }
}

export async function buildApp(config: Environment) {
  const app = Fastify({
    logger: {
      level: 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: redactUrlToken(request.url),
            host: request.headers?.host,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          };
        },
      },
    },
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

  // Runner + webhook realms: token-authenticated, OUTSIDE the session scope.
  // These MUST remain reachable without a session cookie — runner tokens only.
  app.register(buildRunnerRunsRoutes(config, teamsNotifier));
  app.register(buildWebhooksRoutes(config));

  // Human realm: session-authenticated.
  // registerAuth runs first so request.user is populated for all routes below.
  // In open mode (AUTH_ENABLED unset), registerAuth attaches bootstrap-admin
  // so all human routes work without a real login.
  await app.register(async (scope) => {
    await registerAuth(scope, config);
    await scope.register(buildAuthRoutes(config));
    await scope.register(buildHumanRunsRoutes(config, teamsNotifier));
    await scope.register(agentsRoutes);
    await scope.register(runnersRoutes);
    await scope.register(buildSkillsRoutes(config.SKILLS_DIR));
    await scope.register(buildIntegrationsRoutes(config));
    await scope.register(buildDevToolsRoutes(config));
  });

  return app;
}
