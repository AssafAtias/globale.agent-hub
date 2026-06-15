import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Environment } from './config/environment.js';
import { agentsRoutes } from './api/routes/agents.js';

export function buildApp(config: Environment) {
  const app = Fastify({
    logger: { level: 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(agentsRoutes);

  return app;
}
