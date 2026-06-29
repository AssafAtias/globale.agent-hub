import { describe, it, expect } from 'vitest';
import { channelDot, teamsDotColor } from './integrations.js';
import { colors } from '../components/dashboard/palette.js';

describe('channelDot', () => {
  it('is "connected" when connected is true and no error', () => {
    expect(channelDot(true, false)).toBe('connected');
  });
  it('is "off" when connected is false and no error', () => {
    expect(channelDot(false, false)).toBe('off');
  });
  it('is "unknown" when data has not loaded yet (connected undefined)', () => {
    expect(channelDot(undefined, false)).toBe('unknown');
  });
  it('is "unknown" on query error even if a stale value exists', () => {
    expect(channelDot(true, true)).toBe('unknown');
  });
});

describe('teamsDotColor', () => {
  it('maps connected -> live green', () => {
    expect(teamsDotColor('connected')).toBe(colors.live);
  });
  it('maps off -> faint grey', () => {
    expect(teamsDotColor('off')).toBe(colors.textFaint);
  });
  it('maps unknown -> muted grey', () => {
    expect(teamsDotColor('unknown')).toBe(colors.textMuted);
  });
});
