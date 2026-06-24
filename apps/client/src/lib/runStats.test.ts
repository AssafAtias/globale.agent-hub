import { describe, it, expect } from 'vitest';
import type { Run, Agent } from '../api/client.js';
import { selectActiveRuns, computeAgentHealth, filterFeed } from './runStats.js';

function run(p: Partial<Run> & { id: string; agentId: string; status: string; createdAt: string }): Run {
  return {
    trigger: 'manual', result: null, error: null, finishedAt: null, ...p,
  } as Run;
}
function agent(id: string, name: string): Agent {
  return { id, name } as unknown as Agent;
}

const agents = [agent('a1', 'Alpha'), agent('a2', 'Beta'), agent('a3', 'Gamma')];
const runs: Run[] = [
  run({ id: 'r1', agentId: 'a1', status: 'done',    createdAt: '2026-06-24T10:00:00.000Z' }),
  run({ id: 'r2', agentId: 'a1', status: 'failed',  createdAt: '2026-06-24T11:00:00.000Z' }),
  run({ id: 'r3', agentId: 'a1', status: 'running', createdAt: '2026-06-24T12:00:00.000Z' }),
  run({ id: 'r4', agentId: 'a2', status: 'pending', createdAt: '2026-06-24T09:30:00.000Z' }),
];

describe('selectActiveRuns', () => {
  it('returns only pending/running, newest first', () => {
    const active = selectActiveRuns(runs);
    expect(active.map((r) => r.id)).toEqual(['r3', 'r4']);
  });
  it('does not mutate the input array', () => {
    const input = [...runs];
    selectActiveRuns(input);
    expect(input.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('computeAgentHealth', () => {
  it('counts done/failed/running and computes success rate', () => {
    const health = computeAgentHealth(runs, agents);
    const a1 = health.find((h) => h.agent.id === 'a1')!;
    expect(a1.total).toBe(3);
    expect(a1.done).toBe(1);
    expect(a1.failed).toBe(1);
    expect(a1.running).toBe(1);
    expect(a1.successRate).toBe(0.5);
    expect(a1.lastRunAt).toBe('2026-06-24T12:00:00.000Z');
    expect(a1.lastStatus).toBe('running');
  });
  it('returns null success rate for an agent with no finished runs', () => {
    const a2 = computeAgentHealth(runs, agents).find((h) => h.agent.id === 'a2')!;
    expect(a2.running).toBe(1);
    expect(a2.successRate).toBeNull();
  });
  it('zeroes an agent with no runs', () => {
    const a3 = computeAgentHealth(runs, agents).find((h) => h.agent.id === 'a3')!;
    expect(a3).toMatchObject({ total: 0, done: 0, failed: 0, running: 0, successRate: null, lastRunAt: null, lastStatus: null });
  });
  it('returns one entry per agent, in agents order', () => {
    expect(computeAgentHealth(runs, agents).map((h) => h.agent.id)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('filterFeed', () => {
  it('returns all runs newest-first with an empty filter', () => {
    expect(filterFeed(runs, {}).map((r) => r.id)).toEqual(['r3', 'r2', 'r1', 'r4']);
  });
  it('filters by agentId', () => {
    expect(filterFeed(runs, { agentId: 'a1' }).map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });
  it('filters by status', () => {
    expect(filterFeed(runs, { status: 'failed' }).map((r) => r.id)).toEqual(['r2']);
  });
  it('treats empty-string filters as no filter', () => {
    expect(filterFeed(runs, { agentId: '', status: '' })).toHaveLength(4);
  });
  it('does not mutate the input array', () => {
    const input = [...runs];
    filterFeed(input, { agentId: 'a1' });
    expect(input).toHaveLength(4);
  });
});
