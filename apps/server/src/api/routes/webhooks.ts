import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { parseGitLabEvent, parseJiraEvent, parseBitbucketEvent, matchAgents } from '../../services/WebhookMatcher.js';
import { RunRepository } from '../../services/RunRepository.js';
import { ContextFetcher } from '../../services/ContextFetcher.js';
import { ownerForAgent } from '../../services/ownership.js';
import type { Environment } from '../../config/environment.js';

export function buildWebhooksRoutes(config: Environment): FastifyPluginAsyncTypebox {
  return async (app) => {
    if (!config.JIRA_WEBHOOK_SECRET) {
      app.log.warn('[webhooks] JIRA_WEBHOOK_SECRET is not set — /webhooks/jira is unauthenticated');
    }
    if (!config.BITBUCKET_WEBHOOK_SECRET) {
      app.log.warn('[webhooks] BITBUCKET_WEBHOOK_SECRET is not set — /webhooks/bitbucket is unauthenticated');
    }

    const fetcher = new ContextFetcher(
      config.GITLAB_API_TOKEN,
      config.JIRA_API_TOKEN,
      config.JIRA_BASE_URL,
      config.JIRA_EMAIL,
      config.BITBUCKET_API_TOKEN,
      config.BITBUCKET_USERNAME,
    );

    app.post('/webhooks/gitlab', {
      schema: {
        headers: Type.Object({ 'x-gitlab-token': Type.String() }, { additionalProperties: true }),
        body: Type.Any(),
      },
    }, async (req, reply) => {
      const token = req.headers['x-gitlab-token'] as string | undefined;
      if (token !== config.GITLAB_WEBHOOK_SECRET) {
        return reply.status(401).send({ error: 'Invalid webhook token' });
      }

      const event = parseGitLabEvent(req.body as Record<string, unknown>);
      if (!event) return reply.status(200).send({ skipped: true });

      const matched = matchAgents(event);
      if (matched.length === 0) return reply.status(200).send({ skipped: true, reason: 'no agents match' });

      const context = await fetcher.fetch(event);
      const contextStr = fetcher.serializeForRunner(context);

      const createdRuns = matched.map(agent =>
        RunRepository.create({
          agentId: agent.id,
          trigger: 'webhook',
          triggerPayload: JSON.stringify(req.body),
          context: contextStr,
          userId: ownerForAgent(agent.id),
        })
      );

      app.log.info({ runIds: createdRuns.map(r => r.id) }, 'Created runs from GitLab webhook');
      return reply.status(200).send({ created: createdRuns.length });
    });

    app.post('/webhooks/jira', {
      schema: {
        headers: Type.Object({ 'x-atlassian-token': Type.Optional(Type.String()) }),
        body: Type.Any(),
      },
    }, async (req, reply) => {
      const secret = config.JIRA_WEBHOOK_SECRET;
      if (secret && req.headers['x-atlassian-token'] !== secret) {
        return reply.status(401).send({ error: 'Invalid webhook token' });
      }

      const event = parseJiraEvent(req.body as Record<string, unknown>);
      if (!event) return reply.status(200).send({ skipped: true });

      const matched = matchAgents(event);
      if (matched.length === 0) return reply.status(200).send({ skipped: true });

      const context = await fetcher.fetch(event);
      const contextStr = fetcher.serializeForRunner(context);

      const createdRuns = matched.map(agent =>
        RunRepository.create({
          agentId: agent.id,
          trigger: 'webhook',
          triggerPayload: JSON.stringify(req.body),
          context: contextStr,
          userId: ownerForAgent(agent.id),
        })
      );
      return reply.status(200).send({ created: createdRuns.length });
    });

    app.post('/webhooks/bitbucket', {
      schema: {
        querystring: Type.Object({ token: Type.Optional(Type.String()) }, { additionalProperties: true }),
        headers: Type.Object({ 'x-event-key': Type.Optional(Type.String()) }, { additionalProperties: true }),
        body: Type.Any(),
      },
    }, async (req, reply) => {
      const secret = config.BITBUCKET_WEBHOOK_SECRET;
      if (secret && (req.query as Record<string, unknown>)['token'] !== secret) {
        return reply.status(401).send({ error: 'Invalid webhook token' });
      }

      const eventKey = (req.headers['x-event-key'] as string | undefined) ?? '';
      const event = parseBitbucketEvent(req.body as Record<string, unknown>, eventKey);
      if (!event) return reply.status(200).send({ skipped: true });

      const matched = matchAgents(event);
      if (matched.length === 0) return reply.status(200).send({ skipped: true, reason: 'no agents match' });

      const context = await fetcher.fetch(event);
      const contextStr = fetcher.serializeForRunner(context);

      const createdRuns = matched.map(agent =>
        RunRepository.create({
          agentId: agent.id,
          trigger: 'webhook',
          triggerPayload: JSON.stringify(req.body),
          context: contextStr,
          userId: ownerForAgent(agent.id),
        })
      );
      app.log.info({ runIds: createdRuns.map(r => r.id) }, 'Created runs from Bitbucket webhook');
      return reply.status(200).send({ created: createdRuns.length });
    });
  };
}
