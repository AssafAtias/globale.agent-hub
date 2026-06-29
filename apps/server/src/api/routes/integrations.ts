import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Environment } from '../../config/environment.js';
import { teamsEnabled } from '../../config/environment.js';

const ChannelStatus = Type.Object({ connected: Type.Boolean() });
const TeamsStatusResponse = Type.Object({ bot: ChannelStatus, webhook: ChannelStatus });

export function buildIntegrationsRoutes(config: Environment): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get('/api/integrations/teams', {
      schema: { response: { 200: TeamsStatusResponse } },
    }, async () => ({
      bot: { connected: teamsEnabled(config) },
      webhook: { connected: Boolean(config.TEAMS_WEBHOOK_URL) },
    }));
  };
}
