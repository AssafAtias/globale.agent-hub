import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/environment.js';

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const app = await buildApp(loadConfig());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
