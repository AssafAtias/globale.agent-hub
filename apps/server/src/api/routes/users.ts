import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin } from '../plugins/authPlugin.js';
import { UserRepository } from '../../services/UserRepository.js';

export function buildUsersRoutes(): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/api/users', { preHandler: requireAdmin }, async () => UserRepository.findAll());
    app.patch('/api/users/:id', {
      preHandler: requireAdmin,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({ role: Type.Union([Type.Literal('admin'), Type.Literal('member')]) }),
      },
    }, async (req, reply) => {
      const updated = UserRepository.setRole(req.params.id, req.body.role);
      if (!updated) return reply.status(404).send({ error: 'Not found' });
      return updated;
    });
  };
}
