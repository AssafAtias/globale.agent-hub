import { loadConfig, teamsEnabled } from '../../src/config/environment.js';

describe('Teams config', () => {
  const OLD = process.env;
  afterEach(() => { process.env = OLD; });

  it('parses TEAMS_ALLOWED_USER_IDS into a trimmed array', () => {
    process.env = { ...OLD, MICROSOFT_APP_ID: 'app', TEAMS_ALLOWED_USER_IDS: 'a, b ,c' };
    const cfg = loadConfig();
    expect(cfg.TEAMS_ALLOWED_USER_IDS).toEqual(['a', 'b', 'c']);
  });

  it('teamsEnabled is false when MICROSOFT_APP_ID is unset', () => {
    process.env = { ...OLD, MICROSOFT_APP_ID: undefined };
    expect(teamsEnabled(loadConfig())).toBe(false);
  });

  it('teamsEnabled is true when MICROSOFT_APP_ID is set', () => {
    process.env = { ...OLD, MICROSOFT_APP_ID: 'app' };
    expect(teamsEnabled(loadConfig())).toBe(true);
  });
});
