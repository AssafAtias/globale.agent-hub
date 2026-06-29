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
