import Fastify from 'fastify';
import { buildIntegrationsRoutes } from '../../src/api/routes/integrations.js';
import type { Environment } from '../../src/config/environment.js';

function makeApp(over: Partial<Environment>) {
  // Bare Fastify instance — avoids buildApp's Teams bot-init side effects
  // (assertTeamsColumns / createTeamsAdapter) that fire when MICROSOFT_APP_ID is set.
  const config = {
    MICROSOFT_APP_ID: undefined,
    TEAMS_WEBHOOK_URL: undefined,
    ...over,
  } as Environment;
  const app = Fastify();
  app.register(buildIntegrationsRoutes(config));
  return app;
}

async function get(app: ReturnType<typeof makeApp>) {
  const res = await app.inject({ method: 'GET', url: '/api/integrations/teams' });
  return { status: res.statusCode, body: res.json() };
}

describe('GET /api/integrations/teams', () => {
  it('reports both connected when bot id and webhook url are set', async () => {
    const app = makeApp({ MICROSOFT_APP_ID: 'app-id', TEAMS_WEBHOOK_URL: 'https://flow/webhook' });
    const { status, body } = await get(app);
    expect(status).toBe(200);
    expect(body).toEqual({ bot: { connected: true }, webhook: { connected: true } });
    await app.close();
  });

  it('reports only bot connected when only MICROSOFT_APP_ID is set', async () => {
    const app = makeApp({ MICROSOFT_APP_ID: 'app-id' });
    const { body } = await get(app);
    expect(body).toEqual({ bot: { connected: true }, webhook: { connected: false } });
    await app.close();
  });

  it('reports only webhook connected when only TEAMS_WEBHOOK_URL is set', async () => {
    const app = makeApp({ TEAMS_WEBHOOK_URL: 'https://flow/webhook' });
    const { body } = await get(app);
    expect(body).toEqual({ bot: { connected: false }, webhook: { connected: true } });
    await app.close();
  });

  it('reports neither connected when both are unset', async () => {
    const app = makeApp({});
    const { body } = await get(app);
    expect(body).toEqual({ bot: { connected: false }, webhook: { connected: false } });
    await app.close();
  });
});
