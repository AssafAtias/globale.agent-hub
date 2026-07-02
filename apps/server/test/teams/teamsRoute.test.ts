import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/environment.js';
import { getDb, resetDb } from '../../src/db/client.js';

afterEach(() => resetDb());

it('does not register /api/messages when Teams is disabled', async () => {
  const cfg = { ...loadConfig(), MICROSOFT_APP_ID: undefined } as any;
  getDb(':memory:');
  const app = await buildApp(cfg);
  const res = await app.inject({ method: 'POST', url: '/api/messages', payload: {} });
  expect(res.statusCode).toBe(404);
});
