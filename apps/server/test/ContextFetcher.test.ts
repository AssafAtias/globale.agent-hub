import { ContextFetcher } from '../src/services/ContextFetcher.js';

const TICKET = { key: 'CORE-9', summary: 'S', description: 'D', status: 'Open', labels: [], url: 'u' };

describe('ContextFetcher.fetchOpenAssignedTicket', () => {
  it('returns null when Jira is not configured', async () => {
    const f = new ContextFetcher(undefined, undefined, undefined);
    expect(await f.fetchOpenAssignedTicket()).toBeNull();
  });

  it('wraps a found ticket into FetchedContext', async () => {
    const f = new ContextFetcher(undefined, 'token', 'https://j');
    (f as any).jira = { searchFirstOpenAssigned: async () => TICKET };
    const ctx = await f.fetchOpenAssignedTicket('CORE');
    expect(ctx?.ticket?.key).toBe('CORE-9');
    expect(ctx?.rawPayload).toEqual({});
    expect(f.serializeForRunner(ctx!)).toContain('CORE-9: S');
  });

  it('returns null when no ticket found', async () => {
    const f = new ContextFetcher(undefined, 'token', 'https://j');
    (f as any).jira = { searchFirstOpenAssigned: async () => null };
    expect(await f.fetchOpenAssignedTicket('CORE')).toBeNull();
  });
});

describe('ContextFetcher.fetch MR enrichment', () => {
  const event = {
    platform: 'gitlab',
    eventType: 'mr:opened',
    payload: { project: { path_with_namespace: 'g/r' }, object_attributes: { iid: 7 } },
  };

  function fakeFetcher() {
    const f = new ContextFetcher('gl-token', 'jira-token', 'https://j', 'e@x');
    (f as any).gitlab = {
      getMrContext: async () => ({
        title: 'T', description: 'D', sourceBranch: 'feature/CORE-9-x',
        targetBranch: 'main', mrUrl: 'u', diff: 'DIFFTEXT',
      }),
      getMrPipeline: async () => ({ status: 'failed', failedJobs: ['build', 'test'] }),
      getMrDiscussions: async () => ([{ author: 'Alice', body: 'nit' }]),
    };
    (f as any).jira = {
      getTicket: async (k: string) => ({ key: k, summary: 'S', description: 'TD', status: 'Open', labels: [], url: 'u' }),
    };
    return f;
  }

  it('enriches with linked ticket, pipeline, and comments', async () => {
    const f = fakeFetcher();
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('DIFFTEXT');
    expect(s).toContain('CORE-9: S');
    expect(s).toContain('Failed jobs: build, test');
    expect(s).toContain('- Alice: nit');
  });

  it('is best-effort: a pipeline fetch error does not drop diff/ticket/comments', async () => {
    const f = fakeFetcher();
    (f as any).gitlab.getMrPipeline = async () => { throw new Error('boom'); };
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('DIFFTEXT');
    expect(s).toContain('CORE-9: S');
    expect(s).toContain('- Alice: nit');
    expect(s).not.toContain('Pipeline');
  });

  it('omits sections when pipeline is null and discussions empty', async () => {
    const f = fakeFetcher();
    (f as any).gitlab.getMrPipeline = async () => null;
    (f as any).gitlab.getMrDiscussions = async () => [];
    const s = f.serializeForRunner(await f.fetch(event as any));
    expect(s).toContain('DIFFTEXT');
    expect(s).not.toContain('Existing MR Comments');
  });
});
