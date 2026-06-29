import { processTeamsMessage, type TeamsTurn, type TeamsBotDeps } from '../../src/services/teams/TeamsBot.js';

function makeTurn(over: Partial<TeamsTurn> = {}): { turn: TeamsTurn; replies: string[] } {
  const replies: string[] = [];
  const turn: TeamsTurn = {
    text: 'pr-review: do it',
    aadObjectId: 'u1',
    conversationReference: '{"conversation":{"id":"c1"}}',
    reply: async (t: string) => { replies.push(t); },
    ...over,
  };
  return { turn, replies };
}

function makeDeps(over: Partial<TeamsBotDeps> = {}): { deps: TeamsBotDeps; created: any[]; targets: any[] } {
  const created: any[] = [];
  const targets: any[] = [];
  const deps: TeamsBotDeps = {
    allowedUserIds: ['u1'],
    agents: {
      findBySlug: (s) => (s === 'pr-review' ? { id: 'agent-1', name: 'PR Review' } : null),
      setTeamsTarget: (id, ref) => { targets.push({ id, ref }); return {}; },
      listSlugs: () => ['pr-review', 'code-reviewer'],
    },
    runs: { create: (d) => { created.push(d); return { id: 'run-1' }; } },
    ...over,
  };
  return { deps, created, targets };
}

describe('processTeamsMessage', () => {
  it('denies users not on the allowlist', async () => {
    const { turn, replies } = makeTurn({ aadObjectId: 'intruder' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created).toHaveLength(0);
    expect(replies[0]).toMatch(/not authorized/i);
  });

  it('creates a run with replyTo and acks for a valid command', async () => {
    const { turn, replies } = makeTurn();
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    const created0 = created[0];
    expect(JSON.parse(created0.context)).toEqual({ 'User request': 'do it' });
    expect(created0).toMatchObject({
      agentId: 'agent-1', trigger: 'teams',
      replyTo: '{"conversation":{"id":"c1"}}',
    });
    expect(replies[0]).toMatch(/running/i);
  });

  it('replies with the agent list on help', async () => {
    const { turn, replies } = makeTurn({ text: 'help' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created).toHaveLength(0);
    expect(replies[0]).toMatch(/pr-review/);
  });

  it('handles set-channel by saving the conversation reference', async () => {
    const { turn, replies } = makeTurn({ text: 'set-channel pr-review' });
    const { deps, targets, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(targets[0]).toEqual({ id: 'agent-1', ref: '{"conversation":{"id":"c1"}}' });
    expect(replies[0]).toMatch(/will post here/i);
    expect(created).toHaveLength(0);
  });

  it('errors clearly for an unknown slug', async () => {
    const { turn, replies } = makeTurn({ text: 'ghost: hi' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    expect(created).toHaveLength(0);
    expect(replies[0]).toMatch(/unknown agent/i);
  });

  it('does not throw if the ack reply fails after the run is created', async () => {
    const { turn } = makeTurn({ reply: async () => { throw new Error('teams down'); } });
    const { deps, created } = makeDeps();
    await expect(processTeamsMessage(turn, deps)).resolves.toBeUndefined();
    expect(created).toHaveLength(1); // run still created
  });

  it('stores context as a JSON object string the runner can parse', async () => {
    const { turn } = makeTurn({ text: 'pr-review: investigate the bug' });
    const { deps, created } = makeDeps();
    await processTeamsMessage(turn, deps);
    const parsed = JSON.parse(created[0].context);
    expect(typeof parsed).toBe('object');
    expect(Object.values(parsed)).toContain('investigate the bug');
  });
});
