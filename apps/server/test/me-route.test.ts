import Fastify from 'fastify';
import { buildAuthRoutes } from '../src/api/routes/auth.js';
import { loadConfig } from '../src/config/environment.js';

describe('GET /api/me', () => {
  it('returns the attached user, else 401', async () => {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = req.headers['x-test-user'] ? { id: 'u', email: 'e@x', name: 'N', role: 'member' } : null;
    });
    await app.register(buildAuthRoutes(loadConfig()));
    const anon = await app.inject({ method: 'GET', url: '/api/me' });
    expect(anon.statusCode).toBe(401);
    const authed = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-test-user': '1' } });
    expect(authed.json()).toMatchObject({ id: 'u', role: 'member' });
    await app.close();
  });
});
