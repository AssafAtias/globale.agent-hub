import Fastify from 'fastify';
import { getDb, resetDb } from '../src/db/client.js';
import { UserRepository } from '../src/services/UserRepository.js';
import { buildUsersRoutes } from '../src/api/routes/users.js';

function setup() {
  const db = getDb(':memory:');
  (db as any).$client.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', entra_object_id TEXT, name TEXT);`);
}
async function appAs(user: any) {
  const app = Fastify();
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req) => { (req as any).user = user; });
  await app.register(buildUsersRoutes());
  return app;
}

describe('users routes', () => {
  beforeEach(() => { resetDb(); setup(); });
  afterAll(() => resetDb());

  it('member is forbidden; admin lists + sets role', async () => {
    const u = UserRepository.upsertByEntraOid({ entraObjectId: 'o1', email: 'a@x', name: 'A' }); // admin (first)
    const member = await appAs({ id: 'm', role: 'member' });
    expect((await member.inject({ method: 'GET', url: '/api/users' })).statusCode).toBe(403);
    await member.close();
    const admin = await appAs({ id: u.id, role: 'admin' });
    expect((await admin.inject({ method: 'GET', url: '/api/users' })).json()).toHaveLength(1);
    const patched = await admin.inject({ method: 'PATCH', url: `/api/users/${u.id}`, payload: { role: 'member' } });
    expect(patched.json().role).toBe('member');
    await admin.close();
  });
});
