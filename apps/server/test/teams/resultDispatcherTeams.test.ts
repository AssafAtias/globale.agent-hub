import { ResultDispatcher } from '../../src/services/ResultDispatcher.js';

function run(over: any = {}) {
  return { id: 'r1', result: 'the result', triggerPayload: '{}', replyTo: null, ...over } as any;
}
function agent(over: any = {}) {
  return { id: 'a1', name: 'PR Review', outputs: JSON.stringify(['teams']), teamsTarget: null, ...over } as any;
}

describe('ResultDispatcher teams output', () => {
  it('posts to run.replyTo when present', async () => {
    const posts: any[] = [];
    const notifier = { post: async (ref: any, text: string) => { posts.push({ ref, text }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, notifier);
    await d.dispatch(run({ replyTo: '{"conversation":{"id":"c1"}}' }), agent());
    expect(posts).toHaveLength(1);
    expect(posts[0].ref).toEqual({ conversation: { id: 'c1' } });
    expect(posts[0].text).toMatch(/the result/);
  });

  it('falls back to agent.teamsTarget when replyTo is null', async () => {
    const posts: any[] = [];
    const notifier = { post: async (ref: any, text: string) => { posts.push({ ref, text }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, notifier);
    await d.dispatch(run(), agent({ teamsTarget: '{"conversation":{"id":"ch1"}}' }));
    expect(posts[0].ref).toEqual({ conversation: { id: 'ch1' } });
  });

  it('does nothing when there is no target', async () => {
    const posts: any[] = [];
    const notifier = { post: async (ref: any, text: string) => { posts.push({ ref, text }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, notifier);
    await d.dispatch(run(), agent());
    expect(posts).toHaveLength(0);
  });

  it('skips the teams branch when no notifier is wired', async () => {
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, undefined);
    await expect(d.dispatch(run({ replyTo: '{"conversation":{"id":"c1"}}' }), agent())).resolves.toBeUndefined();
  });
});

describe('ResultDispatcher teams_webhook output', () => {
  it('calls postResult with (agentName, done, result) when output is teams_webhook and result is present', async () => {
    const calls: any[] = [];
    const webhook = { postResult: async (agentName: string, status: string, body: string) => { calls.push({ agentName, status, body }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, undefined, webhook);
    await d.dispatch(run(), agent({ outputs: JSON.stringify(['teams_webhook']) }));
    expect(calls).toHaveLength(1);
    expect(calls[0].agentName).toBe('PR Review');
    expect(calls[0].status).toBe('done');
    expect(calls[0].body).toBe('the result');
  });

  it('is a no-op when no teamsWebhook is wired (6th arg undefined)', async () => {
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, undefined, undefined);
    await expect(d.dispatch(run(), agent({ outputs: JSON.stringify(['teams_webhook']) }))).resolves.toBeUndefined();
  });

  it('does not call postResult when agent outputs does not include teams_webhook', async () => {
    const calls: any[] = [];
    const webhook = { postResult: async (agentName: string, status: string, body: string) => { calls.push({ agentName, status, body }); } };
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, undefined, webhook);
    await d.dispatch(run(), agent({ outputs: JSON.stringify(['dashboard']) }));
    expect(calls).toHaveLength(0);
  });
});
