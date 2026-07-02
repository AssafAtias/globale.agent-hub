import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { RunnerRepository } from '../../services/RunnerRepository.js';
import { randomUUID } from 'crypto';

export const runnersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post('/api/runners/register', {
    schema: {
      body: Type.Object({ name: Type.String() }),
      response: { 201: Type.Object({ runnerId: Type.String(), token: Type.String() }) },
    },
  }, async (req, reply) => {
    const token = randomUUID();
    // Bind the runner to the creating user so its owner's runs route to it.
    // In open mode req.user is the bootstrap admin; in auth mode it's the logged-in user.
    const { runner } = RunnerRepository.register(req.body.name, token, req.user?.id ?? null);
    return reply.status(201).send({ runnerId: runner.id, token });
  });

  app.get('/api/runners', { schema: { response: { 200: Type.Array(Type.Any()) } } },
    async (req) => {
      const all = RunnerRepository.findAll();
      return req.user?.role === 'admin' ? all : all.filter(r => r.userId === req.user?.id);
    }
  );
};
