import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { CloudAdapter } from 'botbuilder';
import type { ActivityHandler } from 'botbuilder';

export function buildTeamsRoutes(adapter: CloudAdapter, bot: ActivityHandler): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.post('/api/messages', { schema: { body: Type.Any() } }, async (req, reply) => {
      // CloudAdapter writes directly to the raw Node response; tell Fastify to back off.
      reply.hijack();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await adapter.process(req.raw, reply.raw as any, (context) => bot.run(context));
    });
  };
}
