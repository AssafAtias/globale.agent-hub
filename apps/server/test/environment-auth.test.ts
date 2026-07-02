import { loadConfig, authEnabled } from '../src/config/environment.js';

describe('auth env', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('authEnabled is false by default', () => {
    process.env = { ...OLD, AUTH_ENABLED: undefined, NODE_ENV: 'test' } as any;
    expect(authEnabled(loadConfig())).toBe(false);
  });

  it('authEnabled true parses ENTRA vars and RUN_STALE_TIMEOUT_MS default', () => {
    process.env = { ...OLD, AUTH_ENABLED: 'true', ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', ENTRA_CLIENT_SECRET: 's', SESSION_SECRET: 'x'.repeat(32), PUBLIC_BASE_URL: 'https://h', NODE_ENV: 'test' } as any;
    const c = loadConfig();
    expect(authEnabled(c)).toBe(true);
    expect(c.RUN_STALE_TIMEOUT_MS).toBe(780000);
  });
});
