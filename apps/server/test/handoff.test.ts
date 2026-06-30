import { parseParentChain, planHandoff, MAX_HANDOFF_DEPTH } from '../src/services/handoff.js';

describe('parseParentChain', () => {
  it('returns depth 0 + [] for a top-level run (no handoff in payload)', () => {
    expect(parseParentChain('{}')).toEqual({ depth: 0, chainAgentIds: [] });
  });
  it('reads depth + chain from payload', () => {
    const p = JSON.stringify({ handoff: { depth: 2, chainAgentIds: ['a', 'b'] } });
    expect(parseParentChain(p)).toEqual({ depth: 2, chainAgentIds: ['a', 'b'] });
  });
  it('returns depth 0 + [] on garbage', () => {
    expect(parseParentChain('not json')).toEqual({ depth: 0, chainAgentIds: [] });
  });
});

describe('planHandoff', () => {
  const parent = (over = {}) => ({ id: 'r1', agentId: 'reviewer', triggerPayload: '{}', ...over });
  it('spawns with depth+1, extended chain, and the message in context', () => {
    const plan = planHandoff(parent(), 'fixer', 'do the fix');
    expect(plan.spawn).toBe(true);
    if (!plan.spawn) return;
    const tp = JSON.parse(plan.childTriggerPayload);
    expect(tp.handoff.depth).toBe(1);
    expect(tp.handoff.chainAgentIds).toEqual(['reviewer']);
    expect(tp.handoff.fromRunId).toBe('r1');
    expect(JSON.parse(plan.context)['Handoff request']).toBe('do the fix');
  });
  it('refuses at depth >= MAX', () => {
    const tp = JSON.stringify({ handoff: { depth: MAX_HANDOFF_DEPTH, chainAgentIds: [] } });
    expect(planHandoff(parent({ triggerPayload: tp }), 'fixer', 'm').spawn).toBe(false);
  });
  it('refuses a self-handoff', () => {
    expect(planHandoff(parent(), 'reviewer', 'm').spawn).toBe(false);
  });
  it('refuses a cycle (target already in chain)', () => {
    const tp = JSON.stringify({ handoff: { depth: 1, chainAgentIds: ['fixer'] } });
    expect(planHandoff(parent({ triggerPayload: tp }), 'fixer', 'm').spawn).toBe(false);
  });
});
