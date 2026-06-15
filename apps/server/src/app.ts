import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Environment } from './config/environment.js';
import { agentsRoutes } from './api/routes/agents.js';
import { runsRoutes } from './api/routes/runs.js';
import { runnersRoutes } from './api/routes/runners.js';

export function buildApp(config: Environment) {
  const app = Fastify({
    logger: { level: 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(agentsRoutes);
  app.register(runsRoutes);
  app.register(runnersRoutes);

  return app;
}
