import { describe, it, expect } from 'vitest';
import type { Runner } from '../api/client.js';
import { runnerStats } from './runners.js';

function runner(id: string, status: string): Runner {
  return { id, name: id, status, lastSeen: '2026-06-24T10:00:00.000Z' };
}

describe('runnerStats', () => {
  it('counts online and total', () => {
    const stats = runnerStats([runner('a', 'online'), runner('b', 'offline'), runner('c', 'online')]);
    expect(stats).toEqual({ online: 2, total: 3 });
  });
  it('treats any non-online status as not online', () => {
    expect(runnerStats([runner('a', 'idle'), runner('b', 'stale')])).toEqual({ online: 0, total: 2 });
  });
  it('handles an empty list', () => {
    expect(runnerStats([])).toEqual({ online: 0, total: 0 });
  });
});
