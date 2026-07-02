import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin } from '../plugins/authPlugin.js';
import { AgentRepository } from '../../services/AgentRepository.js';
import { AgentMemoryRepository } from '../../services/AgentMemoryRepository.js';

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
    cron: Type.Optional(Type.String()),
  }),
  outputs: Type.Array(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  avatarKey: Type.Optional(Type.String({ maxLength: 64 })),
  title: Type.Optional(Type.String({ maxLength: 80 })),
  bio: Type.Optional(Type.String({ maxLength: 500 })),
  skills: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  focus: Type.Optional(Type.String({ maxLength: 4000 })),
  ownerId: Type.Optional(Type.String()),
});

export const agentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/api/agents', {
    schema: {
      querystring: Type.Object({ includeArchived: Type.Optional(Type.Boolean()) }),
      response: { 200: Type.Array(Type.Any()) },
    },
  }, async (req) =>
    AgentRepository.findAll({ includeArchived: req.query.includeArchived ?? false })
  );

  app.post('/api/agents', { preHandler: requireAdmin, schema: { body: AgentBody, response: { 201: Type.Any() } } },
    async (req, reply) => {
      const agent = AgentRepository.create({
        ...req.body,
        repos: JSON.stringify(req.body.repos),
        triggerRules: JSON.stringify(req.body.triggerRules),
        outputs: JSON.stringify(req.body.outputs),
        avatarKey: req.body.avatarKey ?? null,
        title: req.body.title ?? null,
        bio: req.body.bio ?? null,
        skills: JSON.stringify(req.body.skills ?? []),
        focus: req.body.focus ?? null,
        ownerId: req.body.ownerId ?? req.user?.id ?? null,
      });
      return reply.status(201).send(agent);
    }
  );

  // Static route — MUST be declared before '/api/agents/:id' so 'reorder'
  // is not matched as an :id param (mirrors /api/runs/next).
  app.patch('/api/agents/reorder', {
    preHandler: requireAdmin,
    schema: {
      body: Type.Object({ ids: Type.Array(Type.String()) }),
      response: { 204: Type.Any() },
    },
  }, async (req, reply) => {
    AgentRepository.reorder(req.body.ids);
    return reply.status(204).send();
  });

  app.patch('/api/agents/:id', {
    preHandler: requireAdmin,
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({ archived: Type.Boolean() }),
      response: { 200: Type.Any(), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const updated = AgentRepository.setArchived(req.params.id, req.body.archived);
    if (!updated) return reply.status(404).send({ error: 'Not found' });
    return updated;
  });

  app.get('/api/agents/:id', {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    return agent;
  });

  app.put('/api/agents/:id', {
    preHandler: requireAdmin,
    schema: { params: Type.Object({ id: Type.String() }), body: Type.Partial(AgentBody) },
  }, async (req, reply) => {
    // repos/triggerRules/outputs are stored as JSON text columns, so serialize
    // any structured fields the client sent before persisting (mirrors POST).
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...body };
    if (body.repos !== undefined) patch.repos = JSON.stringify(body.repos);
    if (body.triggerRules !== undefined) patch.triggerRules = JSON.stringify(body.triggerRules);
    if (body.outputs !== undefined) patch.outputs = JSON.stringify(body.outputs);
    if (body.skills !== undefined) patch.skills = JSON.stringify(body.skills);
    const updated = AgentRepository.update(req.params.id, patch as any);
    if (!updated) return reply.status(404).send({ error: 'Not found' });
    return updated;
  });

  app.delete('/api/agents/:id', {
    preHandler: requireAdmin,
    schema: { params: Type.Object({ id: Type.String() }) },
  }, async (req, reply) => {
    AgentRepository.delete(req.params.id);
    return reply.status(204).send();
  });

  const MEMORY_INJECT_LIMIT = 20;

  app.get('/api/agents/:id/memory', {
    schema: { params: Type.Object({ id: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    const entries = AgentMemoryRepository.listForAgent(req.params.id, MEMORY_INJECT_LIMIT)
      .map((e) => ({ id: e.id, runId: e.runId, note: e.note, createdAt: e.createdAt }));
    return { focus: agent.focus ?? null, entries };
  });

  app.post('/api/agents/:id/memory', {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({ runId: Type.Optional(Type.String()), note: Type.String() }),
      response: { 201: Type.Any(), 400: Type.Any(), 404: Type.Any() },
    },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    if (!req.body.note.trim()) return reply.status(400).send({ error: 'note is required' });
    const entry = AgentMemoryRepository.append({
      agentId: req.params.id, runId: req.body.runId ?? null, note: req.body.note.trim(),
    });
    return reply.status(201).send(entry);
  });

  app.delete('/api/agents/:id/memory', {
    schema: { params: Type.Object({ id: Type.String() }), response: { 204: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const agent = AgentRepository.findById(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Not found' });
    AgentMemoryRepository.clearForAgent(req.params.id);
    return reply.status(204).send();
  });
};
