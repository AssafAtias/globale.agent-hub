import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Environment } from '../../config/environment.js';
import { generateVwoSessions } from '../../services/vwo/generateSessions.js';

const CAMPAIGN = 'ShippingAddressValidation';
const BASE_URL = 'https://checkout-service-qa-hf.bglobale.com';

/** Dev-only, flag-gated tool that generates N VWO checkout sessions and returns a summary. */
export function buildDevToolsRoutes(
  config: Environment,
  generate: typeof generateVwoSessions = generateVwoSessions,
): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/api/dev/vwo-generate-sessions',
      { schema: { querystring: Type.Object({ n: Type.Optional(Type.Integer()) }) } },
      async (req, reply) => {
        if (!config.VWO_GENERATE_ENABLED) return reply.code(404).send({ error: 'not found' });
        const n = Math.min(Math.max(req.query.n ?? 100, 1), 500);
        return generate({
          baseUrl: BASE_URL,
          merchantId: 30000603,
          countryCode: 'US',
          cultureCode: 'en-US',
          campaignKey: CAMPAIGN,
          n,
        });
      },
    );
  };
}
