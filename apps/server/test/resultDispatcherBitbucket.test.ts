import { ResultDispatcher } from '../src/services/ResultDispatcher.js';

function run(result: string, payload: object) {
  return { id: 'r1', result, triggerPayload: JSON.stringify(payload), replyTo: null } as any;
}
const agent = { id: 'a1', name: 'Rev', outputs: JSON.stringify(['pr_comment']), teamsTarget: null } as any;

describe('ResultDispatcher pr_comment routing', () => {
  it('routes a Bitbucket-shaped payload to the bitbucket client', async () => {
    const d = new ResultDispatcher(undefined, undefined, undefined, undefined, undefined, undefined, 'bbtok');
    const calls: any[] = [];
    (d as any).bitbucket = { postPrComment: async (repo: string, id: number, body: string) => { calls.push({ repo, id, body }); } };
    await d.dispatch(run('REVIEW', { repository: { full_name: 'globaleteam/core' }, pullrequest: { id: 7 } }), agent);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ repo: 'globaleteam/core', id: 7 });
    expect(calls[0].body).toContain('REVIEW');
  });
  it('does NOT call the bitbucket client for a GitLab-shaped payload', async () => {
    const d = new ResultDispatcher('gltok', undefined, undefined, undefined, undefined, undefined, 'bbtok');
    const bb: number[] = [];
    (d as any).bitbucket = { postPrComment: async () => { bb.push(1); } };
    (d as any).gitlab = { postMrComment: async () => {} };
    await d.dispatch(run('R', { object_attributes: { iid: 3 }, project: { path_with_namespace: 'g/r' } }), agent);
    expect(bb).toHaveLength(0);
  });
});
