import Fastify from 'fastify';
import { buildDevToolsRoutes } from '../src/api/routes/devTools.js';
import type { Environment } from '../src/config/environment.js';

function appWith(enabled: boolean, generate: any) {
  const app = Fastify();
  const config = { VWO_GENERATE_ENABLED: enabled } as unknown as Environment;
  app.register(buildDevToolsRoutes(config, generate));
  return app;
}

describe('GET /api/dev/vwo-generate-sessions', () => {
  it('404 when the flag is off (and never calls the generator)', async () => {
    const generate = jest.fn();
    const app = appWith(false, generate);
    const res = await app.inject({ method: 'GET', url: '/api/dev/vwo-generate-sessions?n=10' });
    expect(res.statusCode).toBe(404);
    expect(generate).not.toHaveBeenCalled();
    await app.close();
  });

  it('200 with the generator result when enabled; defaults n to 100', async () => {
    const generate = jest.fn(async (opts: any) => ({ n: opts.n, variation1: 1, control: 1, none: 0, sessions: [] }));
    const app = appWith(true, generate);
    const res = await app.inject({ method: 'GET', url: '/api/dev/vwo-generate-sessions' });
    expect(res.statusCode).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].n).toBe(100);
    expect(JSON.parse(res.body).n).toBe(100);
    await app.close();
  });

  it('clamps n to the [1,500] range', async () => {
    const generate = jest.fn(async (opts: any) => ({ n: opts.n, variation1: 0, control: 0, none: 0, sessions: [] }));
    const app = appWith(true, generate);
    await app.inject({ method: 'GET', url: '/api/dev/vwo-generate-sessions?n=9999' });
    expect(generate.mock.calls[0][0].n).toBe(500);
    await app.close();
  });
});
