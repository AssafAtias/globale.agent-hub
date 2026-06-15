import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Environment } from './config/environment.js';

export function buildApp(config: Environment) {
  const app = Fastify({
    logger: { level: 'info' },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
