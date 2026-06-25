import { describe, it, expect } from 'vitest';
import type { Run, Agent } from '../api/client.js';
import {
  summarizeTrigger, matchesStatusFilter, isRunningState, buildAgentCardModels,
} from './cardView.js';

function run(p: Partial<Run> & { id: string; agentId: string; status: string; createdAt: string }): Run {
  return { trigger: 'manual', result: null, error: null, finishedAt: null, ...p } as Run;
}
function agent(p: Partial<Agent> & { id: string; name: string }): Agent {
  return { type: 'general', model: 'sonnet', triggerRules: '', archived: false, ...p } as unknown as Agent;
}

describe('summarizeTrigger', () => {
  it('prefers a jira label', () => {
    expect(summarizeTrigger(JSON.stringify({ events: ['mr.opened'], jiraLabel: 'ai-build' })))
      .toBe('on Jira label');
  });
  it('falls back to the first event', () => {
    expect(summarizeTrigger(JSON.stringify({ events: ['mr.opened'] }))).toBe('on mr.opened');
  });
  it('returns "manual" for empty / missing / unparseable rules', () => {
    expect(summarizeTrigger('')).toBe('manual');
    expect(summarizeTrigger(null)).toBe('manual');
    expect(summarizeTrigger('not json')).toBe('manual');
    expect(summarizeTrigger(JSON.stringify({ events: [] }))).toBe('manual');
  });
});

describe('isRunningState / matchesStatusFilter', () => {
  it('isRunningState is true for active states only', () => {
    expect(isRunningState('working')).toBe(true);
    expect(isRunningState('reviewing')).toBe(true);
    expect(isRunningState('queued')).toBe(true);
    expect(isRunningState('idle')).toBe(false);
    expect(isRunningState('blocked')).toBe(false);
  });
  it('"all" matches everything', () => {
    expect(matchesStatusFilter('idle', 'all')).toBe(true);
    expect(matchesStatusFilter('working', 'all')).toBe(true);
  });
  it('"running" matches active states', () => {
    expect(matchesStatusFilter('working', 'running')).toBe(true);
    expect(matchesStatusFilter('idle', 'running')).toBe(false);
  });
  it('"idle" matches idle and blocked', () => {
    expect(matchesStatusFilter('idle', 'idle')).toBe(true);
    expect(matchesStatusFilter('blocked', 'idle')).toBe(true);
    expect(matchesStatusFilter('working', 'idle')).toBe(false);
  });
});

describe('buildAgentCardModels', () => {
  const agents = [agent({ id: 'a1', name: 'Alpha' }), agent({ id: 'a2', name: 'Beta' })];
  const runs: Run[] = [
    run({ id: 'r1', agentId: 'a1', status: 'done', createdAt: '2026-06-24T10:00:00.000Z' }),
    run({ id: 'r2', agentId: 'a1', status: 'running', createdAt: '2026-06-24T12:00:00.000Z' }),
  ];
  it('produces one model per agent keyed by id', () => {
    const models = buildAgentCardModels(agents, runs);
    expect([...models.keys()].sort()).toEqual(['a1', 'a2']);
  });
  it('carries health, markers (oldest-first), latest run, and a live state', () => {
    const m = buildAgentCardModels(agents, runs).get('a1')!;
    expect(m.health.total).toBe(2);
    expect(m.markers).toEqual(['done', 'running']);
    expect(m.latest?.id).toBe('r2');
    expect(m.state).toBe('working'); // latest is running, non-reviewer agent
  });
  it('gives a runless agent an idle state and empty markers', () => {
    const m = buildAgentCardModels(agents, runs).get('a2')!;
    expect(m.state).toBe('idle');
    expect(m.markers).toEqual([]);
    expect(m.latest).toBeNull();
  });
});
