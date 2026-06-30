import { isDue, parseCronFromTriggerRules, buildScheduledContext } from '../src/services/schedule.js';

describe('isDue', () => {
  const now = new Date('2026-06-30T12:30:30Z'); // mid-minute, so the prev every-minute slot is unambiguously 12:30:00
  it('is due when never fired and a previous slot exists', () => {
    expect(isDue('* * * * *', null, now)).toBe(true);
  });
  it('is NOT due when the last fire is after the current slot', () => {
    expect(isDue('* * * * *', '2026-06-30T12:30:15Z', now)).toBe(false);
  });
  it('is due when the last fire predates the current slot', () => {
    expect(isDue('* * * * *', '2026-06-30T12:29:30Z', now)).toBe(true);
  });
  it('is NOT due for an invalid cron expression', () => {
    expect(isDue('not a cron', null, now)).toBe(false);
  });
  it('non-uniform: weekday-2am is NOT due on Saturday (next slot is Monday)', () => {
    expect(isDue('0 2 * * 1-5', '2026-07-03T02:00:00', new Date('2026-07-04T12:00:00'))).toBe(false);
  });
  it('non-uniform: weekday-2am IS due on Monday after a Friday run', () => {
    expect(isDue('0 2 * * 1-5', '2026-07-03T02:00:00', new Date('2026-07-06T02:00:30'))).toBe(true);
  });
});

describe('parseCronFromTriggerRules', () => {
  it('extracts a cron string', () => {
    expect(parseCronFromTriggerRules('{"events":[],"cron":"0 2 * * *"}')).toBe('0 2 * * *');
  });
  it('returns null when cron is absent/empty', () => {
    expect(parseCronFromTriggerRules('{"events":[]}')).toBeNull();
    expect(parseCronFromTriggerRules('{"cron":"  "}')).toBeNull();
  });
  it('returns null on garbage JSON', () => {
    expect(parseCronFromTriggerRules('not json')).toBeNull();
  });
});

describe('buildScheduledContext', () => {
  it('always includes the preamble and lists repos', () => {
    const ctx = JSON.parse(buildScheduledContext('["bitbucket:g/core","gitlab:x/y"]'));
    expect(ctx['Scheduled run']).toMatch(/scheduled/i);
    expect(ctx['Repos']).toBe('bitbucket:g/core, gitlab:x/y');
  });
  it('omits Repos for empty/garbage repos', () => {
    expect(JSON.parse(buildScheduledContext('[]'))['Repos']).toBeUndefined();
    expect(JSON.parse(buildScheduledContext('nope'))['Repos']).toBeUndefined();
  });
});
