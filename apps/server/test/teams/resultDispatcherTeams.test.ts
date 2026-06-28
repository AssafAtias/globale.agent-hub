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
