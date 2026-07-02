import Fastify from 'fastify';
import { requireUser, requireAdmin } from '../src/api/plugins/authPlugin.js';

describe('auth guards', () => {
  it('requireUser 401s when no user is attached', async () => {
    const app = Fastify();
    app.get('/x', { preHandler: requireUser }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('requireAdmin 403s for a member', async () => {
    const app = Fastify();
    app.addHook('preHandler', async (req) => { (req as any).user = { id: 'u', role: 'member' }; });
    app.get('/x', { preHandler: requireAdmin }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
