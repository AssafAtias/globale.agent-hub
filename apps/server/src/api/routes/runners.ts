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
    const { runner } = RunnerRepository.register(req.body.name, token);
    return reply.status(201).send({ runnerId: runner.id, token });
  });

  app.get('/api/runners', { schema: { response: { 200: Type.Array(Type.Any()) } } },
    async () => RunnerRepository.findAll()
  );
};
