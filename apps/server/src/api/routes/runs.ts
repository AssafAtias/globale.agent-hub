import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { RunRepository } from '../../services/RunRepository.js';
import { RunnerRepository } from '../../services/RunnerRepository.js';
import { AgentRepository } from '../../services/AgentRepository.js';
import { ResultDispatcher } from '../../services/ResultDispatcher.js';
import { ContextFetcher } from '../../services/ContextFetcher.js';
import type { Environment } from '../../config/environment.js';
import type { TeamsNotifier } from '../../services/teams/TeamsNotifier.js';
import { TeamsWebhookNotifier } from '../../services/teams/TeamsWebhookNotifier.js';

export function buildRunsRoutes(config: Environment, teamsNotifier?: TeamsNotifier): FastifyPluginAsyncTypebox {
  return async (app) => {
    const teamsWebhook = config.TEAMS_WEBHOOK_URL ? new TeamsWebhookNotifier(config.TEAMS_WEBHOOK_URL) : undefined;
    app.get('/api/runs', { schema: { response: { 200: Type.Array(Type.Any()) } } },
      async () => RunRepository.findAll()
    );

    // Long-poll: runner claims next pending job (holds connection up to 30s)
    // MUST be registered before /api/runs/:id to prevent 'next' matching as :id param
    app.get('/api/runs/next', {
      schema: {
        headers: Type.Object({ 'x-runner-token': Type.String() }),
        response: { 200: Type.Any(), 204: Type.Any(), 401: Type.Any() },
      },
    }, async (req, reply) => {
      const runner = RunnerRepository.findByToken(req.headers['x-runner-token']);
      if (!runner) return reply.status(401).send({ error: 'Invalid runner token' });

      RunnerRepository.heartbeat(runner.id);

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const run = RunRepository.claimNext(runner.id);
        if (run) {
          const agent = AgentRepository.findById(run.agentId);
          return { run, agent };
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      return reply.status(204).send();
    });

    app.get('/api/runs/:id', {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: { 200: Type.Any(), 404: Type.Any() },
      },
    }, async (req, reply) => {
      const run = RunRepository.findById(req.params.id);
      if (!run) return reply.status(404).send({ error: 'Not found' });
      return run;
    });

    app.patch('/api/runs/:id', {
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({ archived: Type.Boolean() }),
        response: { 200: Type.Any(), 404: Type.Any() },
      },
    }, async (req, reply) => {
      const updated = RunRepository.setArchived(req.params.id, req.body.archived);
      if (!updated) return reply.status(404).send({ error: 'Not found' });
      return updated;
    });

    // Manual trigger
    app.post('/api/runs', {
      schema: {
        body: Type.Object({ agentId: Type.String() }),
        response: { 201: Type.Any(), 400: Type.Any(), 404: Type.Any(), 409: Type.Any() },
      },
    }, async (req, reply) => {
      const agent = AgentRepository.findById(req.body.agentId);
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });
      if (agent.archived) return reply.status(409).send({ error: 'Agent is archived' });
      if (agent.type === 'ticket-to-code') {
        if (!config.JIRA_API_TOKEN || !config.JIRA_BASE_URL || !config.JIRA_EMAIL) {
          return reply.status(400).send({ error: 'Jira is not configured; set JIRA_API_TOKEN, JIRA_BASE_URL and JIRA_EMAIL' });
        }
        const fetcher = new ContextFetcher(config.GITLAB_API_TOKEN, config.JIRA_API_TOKEN, config.JIRA_BASE_URL, config.JIRA_EMAIL);
        const ctx = await fetcher.fetchOpenAssignedTicket(config.JIRA_PROJECT_KEY);
        if (!ctx) {
          return reply.status(201).send(
            RunRepository.createCompleted({ agentId: agent.id, trigger: 'manual', result: 'No open tasks found.' })
          );
        }
        return reply.status(201).send(RunRepository.create({
          agentId: agent.id, trigger: 'manual',
          triggerPayload: JSON.stringify({ issue: { key: ctx.ticket!.key } }),
          context: fetcher.serializeForRunner(ctx),
        }));
      }
      const run = RunRepository.create({
        agentId: req.body.agentId, trigger: 'manual', triggerPayload: '{}', context: '{}',
      });
      return reply.status(201).send(run);
    });

    // Runner posts result back
    app.post('/api/runs/:id/result', {
      schema: {
        params: Type.Object({ id: Type.String() }),
        headers: Type.Object({ 'x-runner-token': Type.String() }),
        body: Type.Object({
          result: Type.Optional(Type.String()),
          error: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Object({ ok: Type.Boolean() }), 401: Type.Any() },
      },
    }, async (req, reply) => {
      const runner = RunnerRepository.findByToken(req.headers['x-runner-token']);
      if (!runner) return reply.status(401).send({ error: 'Invalid runner token' });

      if (req.body.error) {
        RunRepository.fail(req.params.id, req.body.error);
        const failedRun = RunRepository.findById(req.params.id);
        const failAgent = failedRun ? AgentRepository.findById(failedRun.agentId) : null;
        if (teamsNotifier && failedRun?.replyTo) {
          try {
            await teamsNotifier.post(
              JSON.parse(failedRun.replyTo),
              `**${failAgent?.name ?? 'Agent'}** failed: ${req.body.error}`,
            );
          } catch (e) {
            app.log.error(e, 'Teams failure-notify error');
          }
        }
        if (teamsWebhook) {
          const failOutputs = (() => { try { return JSON.parse(failAgent?.outputs || '[]') as string[]; } catch { return [] as string[]; } })();
          if (failAgent && failOutputs.includes('teams_webhook')) {
            teamsWebhook.postResult(failAgent.name, 'failed', req.body.error)
              .catch(e => app.log.error(e, 'teams_webhook failure-notify error'));
          }
        }
      } else {
        RunRepository.complete(req.params.id, req.body.result ?? '');
        // Fan out result to configured outputs (fire-and-forget)
        const completedRun = RunRepository.findById(req.params.id);
        const agent = completedRun ? AgentRepository.findById(completedRun.agentId) : null;
        if (completedRun && agent && req.body.result) {
          const dispatcher = new ResultDispatcher(
            config.GITLAB_API_TOKEN,
            config.JIRA_API_TOKEN,
            config.JIRA_BASE_URL,
            config.JIRA_EMAIL,
            teamsNotifier,
            teamsWebhook,
          );
          dispatcher.dispatch(completedRun, agent).catch(e =>
            app.log.error(e, 'ResultDispatcher error')
          );
        }
      }
      return reply.status(200).send({ ok: true });
    });
  };
}
