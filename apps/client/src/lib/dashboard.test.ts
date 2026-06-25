import { describe, it, expect } from 'vitest';
import type { Run, Agent } from '../api/client.js';
import { computeDashboardStats, buildWorkerCards, formatCycle, relativeTime } from './dashboard.js';

function run(p: Partial<Run> & { id: string; agentId: string; status: string; createdAt: string }): Run {
  return { trigger: 'manual', result: null, error: null, finishedAt: null, archived: false, ...p } as Run;
}
function agent(p: Partial<Agent> & { id: string; name: string }): Agent {
  return { type: 'worker', model: 'claude-sonnet-4-6', archived: false, ...p } as unknown as Agent;
}

const NOW = new Date('2026-06-25T12:00:00.000Z');

const agents = [
  agent({ id: 'a1', name: 'Ticket to MR', type: 'builder' }),
  agent({ id: 'a2', name: 'Code review', type: 'reviewer' }),
  agent({ id: 'a3', name: 'Docs writer' }),
];
const runs: Run[] = [
  run({ id: 'r1', agentId: 'a1', status: 'running', createdAt: '2026-06-25T11:50:00.000Z' }),
  run({ id: 'r2', agentId: 'a2', status: 'running', createdAt: '2026-06-25T11:55:00.000Z' }),
  run({ id: 'r3', agentId: 'a3', status: 'pending', createdAt: '2026-06-25T11:58:00.000Z' }),
  run({ id: 'r4', agentId: 'a1', status: 'done', createdAt: '2026-06-25T10:00:00.000Z', finishedAt: '2026-06-25T10:10:00.000Z' }),
  run({ id: 'r5', agentId: 'a2', status: 'done', createdAt: '2026-06-24T10:00:00.000Z', finishedAt: '2026-06-24T10:20:00.000Z' }),
];

describe('computeDashboardStats', () => {
  const stats = computeDashboardStats(runs, agents, NOW);
  it('counts agents with a running run', () => expect(stats.activeAgents).toBe(2));
  it('counts pending runs as queued', () => expect(stats.tasksQueued).toBe(1));
  it('counts done runs finished today', () => expect(stats.mrsToday).toBe(1));
  it('averages run duration: (10m + 20m)/2 = 15m', () => expect(stats.avgCycle).toBe('15m'));
});

describe('buildWorkerCards', () => {
  const cards = buildWorkerCards(agents, runs);
  it('maps a running builder to working', () =>
    expect(cards.find((c) => c.agent.id === 'a1')?.state).toBe('working'));
  it('maps a running reviewer to reviewing', () =>
    expect(cards.find((c) => c.agent.id === 'a2')?.state).toBe('reviewing'));
  it('maps a pending run to queued', () =>
    expect(cards.find((c) => c.agent.id === 'a3')?.state).toBe('queued'));
});

describe('formatCycle', () => {
  it('returns em dash for null', () => expect(formatCycle(null)).toBe('—'));
  it('formats seconds', () => expect(formatCycle(45)).toBe('45s'));
  it('formats minutes', () => expect(formatCycle(150)).toBe('3m'));
});

describe('relativeTime', () => {
  it('formats minutes ago', () =>
    expect(relativeTime('2026-06-25T11:49:00.000Z', NOW)).toBe('11m'));
});
