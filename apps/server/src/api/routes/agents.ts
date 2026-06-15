import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { AgentRepository } from '../../services/AgentRepository.js';

const AgentBody = Type.Object({
  name: Type.String(),
  type: Type.Union([Type.Literal('pr-review'), Type.Literal('ticket-to-code')]),
  model: Type.String(),
  prompt: Type.String(),
  repos: Type.Array(Type.String()),
  triggerRules: Type.Object({
    events: Type.Array(Type.String()),
    branchFilter: Type.Optional(Type.String()),
    jiraLabel: Type.Optional(Type.String()),
  }),
  outputs: Type.Array(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
});

export const agentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/api/agents', { schema: { response: { 200: Type.Array(Type.Any()) } } },
    async () => AgentRepository.findAll()
  );

  app.post('/api/agents', { schema: { body: AgentBody, response: { 201: Type.Any() } } },
    async (req, reply) => {
      const agent = AgentRepository.create({
        ...req.body,
        repos: JSON.stringify(req.body.repos),
        triggerRules: JSON.stringify(req.body.triggerRules),
        outputs: JSON.stringify(req.body.outputs),
      });
      return reply.status(201).send(agent);
    }
  );

  app.get('/api/agents/:id', {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    return agent;
  });

  app.put('/api/agents/:id', {
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Partial(AgentBody) },
  }, async (req, reply) => {
    const updated = AgentRepository.update(req.params.id, req.body as any);
    if (!updated) return reply.status(404).send({ error: 'Not found' });
    return updated;
  });

  app.delete('/api/agents/:id', {
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    AgentRepository.delete(req.params.id);
    return reply.status(204).send();
  });
};
