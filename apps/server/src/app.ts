import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Environment } from './config/environment.js';
import { agentsRoutes } from './api/routes/agents.js';
import { buildRunsRoutes } from './api/routes/runs.js';
import { runnersRoutes } from './api/routes/runners.js';
import { buildWebhooksRoutes } from './api/routes/webhooks.js';
import { buildSkillsRoutes } from './api/routes/skills.js';

export function buildApp(config: Environment) {
  const app = Fastify({
    logger: { level: 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(agentsRoutes);
  app.register(buildRunsRoutes(config));
  app.register(runnersRoutes);
  app.register(buildWebhooksRoutes(config));
  app.register(buildSkillsRoutes(config.SKILLS_DIR));

  return app;
}
